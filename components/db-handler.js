/**
 * @file components/db-handler.js
 * @description 멀티 도메인(sanrio, teenieping) Local-First(NAMEQUIZ_ 캐시) 및 Firestore 양방향 동기화 핸들러 모듈
 */

import { db, auth } from './firebase-config.js';
import {
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  setDoc,
  increment,
  limit,
  orderBy,
  query,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { DOMAINS, getCharacters } from './character-data.js';
import { toLocalDateKey, getRecentLocalDateKeys } from './date-utils.js';
import { claimLegacyData } from './legacy-migration.js';

const GUEST_ID_KEY = 'NAMEQUIZ_GUEST_ID';

let currentUserUid = null;
let progressCache = {};
let progressMeta = {};

const PERSISTED_PROGRESS_FIELDS = [
  'domain', 'charId', 'stage', 'recentLatencies', 'latenciesIdx',
  'outCnt', 'resetOutCnt', 'totalSolved', 'lastSessionTime', 'sessionStreak', 'updatedAt'
];

export const toPersistedSchema = (item) => {
  const schema = {};
  PERSISTED_PROGRESS_FIELDS.forEach((field) => {
    if (item[field] !== undefined) schema[field] = item[field];
  });
  return schema;
};

/**
 * 리더보드 필터 값('all_sanrio', 'all_teenieping', 'scope:teenieping-1기', 또는 단일 도메인 키)을
 * Firestore where('domain', '==', ...) 조회용 배열(최대 3개)로 변환한다.
 */
export function resolveLeaderboardQueryDomains(targetFilter = 'all_sanrio') {
  if (targetFilter === 'all_sanrio') {
    return ['sanrio(혼합)', 'sanrio(그림→이름)', 'sanrio(이름→그림)', 'sanrio(질문)'];
  }
  if (targetFilter === 'all_teenieping') {
    return ['teenieping(혼합)', 'teenieping(그림→이름)', 'teenieping(이름→그림)', 'teenieping(질문)'];
  }
  if (targetFilter.startsWith('scope:')) {
    const prefix = targetFilter.slice(6); // 예: 'teenieping-1기'
    return [`${prefix}(혼합)`, `${prefix}(그림→이름)`, `${prefix}(이름→그림)`, `${prefix}(질문)`];
  }
  return [targetFilter];
}

const _getOrCreateGuestId = () => {
  let guestId = localStorage.getItem(GUEST_ID_KEY);
  if (!guestId) {
    guestId = 'GUEST_' + Math.random().toString(36).substring(2, 11);
    localStorage.setItem(GUEST_ID_KEY, guestId);
  }
  return guestId;
};

const _saveLocalProgressCache = () => {
  if (!currentUserUid) return;
  try {
    localStorage.setItem(`NAMEQUIZ_PROGRESS_CACHE_${currentUserUid}`, JSON.stringify(progressCache));
    localStorage.setItem(`NAMEQUIZ_PROGRESS_META_${currentUserUid}`, JSON.stringify(progressMeta));
  } catch (e) {
    console.warn('[LocalFirst] localStorage 동기화 저장 실패:', e);
  }
};

const _loadLocalProgressCache = () => {
  if (!currentUserUid) return false;
  try {
    const cachedData = localStorage.getItem(`NAMEQUIZ_PROGRESS_CACHE_${currentUserUid}`);
    const cachedMeta = localStorage.getItem(`NAMEQUIZ_PROGRESS_META_${currentUserUid}`);
    if (cachedData) {
      progressCache = JSON.parse(cachedData);
      progressMeta = cachedMeta ? JSON.parse(cachedMeta) : {};
      DOMAINS.forEach((d) => {
        if (!progressCache[d]) progressCache[d] = {};
      });
      return true;
    }
  } catch (e) {
    console.warn('[LocalFirst] localStorage 복원 실패:', e);
  }
  return false;
};

export const initUser = async (uid) => {
  currentUserUid = uid || _getOrCreateGuestId();
  // 이전 프로젝트(kana-loop)에서 옮겨 둔 기록이 있으면 먼저 이어 받는다
  if (uid) await claimLegacyData();
  await refreshProgressCache();
};

export const refreshProgressCache = async () => {
  if (!currentUserUid) return;

  const hasLocalCache = _loadLocalProgressCache();
  if (!hasLocalCache) {
    progressCache = {};
    progressMeta = {};
    DOMAINS.forEach((d) => {
      progressCache[d] = {};
      progressMeta[d] = 0;
    });
  }

  try {
    await Promise.all(DOMAINS.map(async (domain) => {
      const charsRef = collection(db, 'users', currentUserUid, 'progress', domain, 'chars');
      const snapshot = await getDocs(charsRef);

      if (!progressCache[domain]) progressCache[domain] = {};

      if (!snapshot.empty) {
        snapshot.forEach((docSnap) => {
          const serverCharData = docSnap.data();
          const localCharData = progressCache[domain][docSnap.id];
          const serverTime = serverCharData.lastSessionTime || serverCharData.updatedAt || 0;
          const localTime = localCharData ? (localCharData.lastSessionTime || localCharData.updatedAt || 0) : -1;

          if (!localCharData || serverTime >= localTime) {
            progressCache[domain][docSnap.id] = serverCharData;
          }
        });
      }
      progressMeta[domain] = Date.now();
    }));

    _saveLocalProgressCache();
  } catch (err) {
    console.warn('[LocalFirst] 서버 동기화 생략 (로컬 캐시 구동):', err.message);
  }
};

export const getAllProgress = async (domain = 'sanrio') => {
  if (!progressCache[domain]) progressCache[domain] = {};
  return progressCache[domain];
};

export const activateSingleCharInDb = async (domain = 'sanrio', charId) => {
  if (!currentUserUid) return null;

  const key = charId.toString();
  const now = Date.now();
  const initialSchema = {
    domain,
    charId: parseInt(charId, 10),
    stage: 1,
    recentLatencies: [2200],
    latenciesIdx: 1,
    outCnt: 0,
    resetOutCnt: 0,
    totalSolved: 1,
    lastSessionTime: now,
    updatedAt: now,
    sessionStreak: 0
  };

  if (!progressCache[domain]) progressCache[domain] = {};
  progressCache[domain][key] = initialSchema;
  progressMeta[domain] = now;
  _saveLocalProgressCache();

  try {
    const docRef = doc(db, 'users', currentUserUid, 'progress', domain, 'chars', key);
    await setDoc(docRef, initialSchema);
  } catch (err) {
    console.warn('[LocalFirst] 단일 캐릭터 해금 서버 저장 생략:', err.message);
  }

  return progressCache[domain];
};

export const resetSingleCharInDb = async (domain = 'sanrio', charId) => {
  if (!currentUserUid) return null;

  const key = charId.toString();
  if (progressCache[domain]) {
    delete progressCache[domain][key];
  }
  progressMeta[domain] = Date.now();
  _saveLocalProgressCache();

  try {
    const docRef = doc(db, 'users', currentUserUid, 'progress', domain, 'chars', key);
    await deleteDoc(docRef);
  } catch (err) {
    console.warn('[LocalFirst] 단일 캐릭터 초기화 서버 반영 생략:', err.message);
  }

  return progressCache[domain] || {};
};

export const unlockAllCharactersInDb = async (domain = 'sanrio', seasonFilter = 'all') => {
  if (!currentUserUid) return null;

  const targetCharacters = getCharacters(domain, seasonFilter);
  if (!progressCache[domain]) progressCache[domain] = {};
  const now = Date.now();
  const batch = writeBatch(db);

  targetCharacters.forEach((meta) => {
    const cId = meta.charId.toString();
    if (progressCache[domain][cId] && progressCache[domain][cId].stage > 0) {
      return;
    }

    const schema = {
      domain,
      charId: meta.charId,
      stage: 1,
      recentLatencies: [2200],
      latenciesIdx: 1,
      outCnt: 0,
      resetOutCnt: 0,
      totalSolved: 1,
      lastSessionTime: now,
      updatedAt: now,
      sessionStreak: 0
    };

    progressCache[domain][cId] = schema;
    const docRef = doc(db, 'users', currentUserUid, 'progress', domain, 'chars', cId);
    batch.set(docRef, schema);
  });

  progressMeta[domain] = now;
  _saveLocalProgressCache();

  try {
    await batch.commit();
  } catch (err) {
    console.warn('[LocalFirst] 일괄 해금 서버 저장 생략:', err.message);
  }

  return progressCache[domain];
};

export const resetAllProgressInDb = async (domain = 'sanrio', seasonFilter = 'all') => {
  if (!currentUserUid) return {};
  if (!progressCache[domain]) progressCache[domain] = {};

  const targetCharacters = getCharacters(domain, seasonFilter);
  const targetIdSet = new Set(targetCharacters.map((m) => String(m.charId)));

  if (domain !== 'teenieping' || seasonFilter === 'all') {
    progressCache[domain] = {};
  } else {
    targetIdSet.forEach((key) => {
      delete progressCache[domain][key];
    });
  }

  progressMeta[domain] = Date.now();
  _saveLocalProgressCache();

  try {
    const colRef = collection(db, 'users', currentUserUid, 'progress', domain, 'chars');
    const snapshot = await getDocs(colRef);
    if (!snapshot.empty) {
      const batch = writeBatch(db);
      snapshot.forEach((docSnap) => {
        if (domain !== 'teenieping' || seasonFilter === 'all' || targetIdSet.has(docSnap.id)) {
          batch.delete(docSnap.ref);
        }
      });
      await batch.commit();
    }
  } catch (err) {
    console.warn('[LocalFirst] 초기화 서버 반영 생략:', err.message);
  }

  return progressCache[domain];
};

export const saveSessionPoolState = async (domain = 'sanrio', sessionPool = []) => {
  if (!currentUserUid || !sessionPool || sessionPool.length === 0) return;

  const now = Date.now();
  if (!progressCache[domain]) progressCache[domain] = {};
  progressMeta[domain] = now;

  const persistedItems = sessionPool.map((item) => toPersistedSchema({ ...item, domain, updatedAt: now }));
  persistedItems.forEach((item) => {
    progressCache[domain][item.charId.toString()] = item;
  });
  _saveLocalProgressCache();

  try {
    const batch = writeBatch(db);
    persistedItems.forEach((item) => {
      const key = item.charId.toString();
      const docRef = doc(db, 'users', currentUserUid, 'progress', domain, 'chars', key);
      batch.set(docRef, item);
    });

    const userDocRef = doc(db, 'users', currentUserUid);
    batch.set(userDocRef, { namequizProgressMeta: { [domain]: now } }, { merge: true });
    await batch.commit();
  } catch (err) {
    console.warn('[LocalFirst] 비동기 세션 배치 DB 저장 실패 (로컬 보존):', err.message);
  }
};

export const updateDailyStudyTime = async (seconds, domain = 'sanrio') => {
  if (!currentUserUid || !domain || seconds <= 0) return;

  const today = toLocalDateKey();
  const storageKey = `NAMEQUIZ_STUDY_STATS_${currentUserUid}`;

  try {
    const rawStats = localStorage.getItem(storageKey);
    const statsObj = rawStats ? JSON.parse(rawStats) : {};
    if (!statsObj[today]) statsObj[today] = {};
    statsObj[today][domain] = (statsObj[today][domain] || 0) + seconds;
    localStorage.setItem(storageKey, JSON.stringify(statsObj));
  } catch (e) {
    console.warn('[LocalFirst] 일일 학습시간 로컬 저장 실패:', e);
  }

  try {
    const docRef = doc(db, 'users', currentUserUid, 'study_stats', today);
    await setDoc(docRef, {
      [domain]: increment(seconds),
      lastUpdated: Date.now()
    }, { merge: true });
  } catch (err) {
    console.warn('[LocalFirst] 일일 학습시간 DB 저장 생략:', err.message);
  }
};

export const saveUserConfig = async (config) => {
  if (!currentUserUid) return;

  try {
    localStorage.setItem(`NAMEQUIZ_CONFIG_${currentUserUid}`, JSON.stringify(config));
  } catch (e) {
    console.warn('[LocalFirst] Config 로컬 저장 실패:', e);
  }

  try {
    const docRef = doc(db, 'users', currentUserUid);
    await setDoc(docRef, { namequizConfig: config, namequizConfigUpdatedAt: Date.now() }, { merge: true });
  } catch (e) {
    console.warn('[LocalFirst] Config DB 저장 생략:', e.message);
  }
};

export const getUserConfig = async () => {
  if (!currentUserUid) return null;

  try {
    const cachedConfig = localStorage.getItem(`NAMEQUIZ_CONFIG_${currentUserUid}`);
    if (cachedConfig) return JSON.parse(cachedConfig);
  } catch (e) {
    console.warn('[LocalFirst] Config 로컬 복원 실패:', e);
  }

  try {
    const docRef = doc(db, 'users', currentUserUid);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists() && docSnap.data().namequizConfig) {
      const config = docSnap.data().namequizConfig;
      localStorage.setItem(`NAMEQUIZ_CONFIG_${currentUserUid}`, JSON.stringify(config));
      return config;
    }
  } catch (e) {
    console.warn('[LocalFirst] Config 서버 수급 생략:', e.message);
  }

  return null;
};



function formatRankingDoc(docSnap) {
  const data = docSnap.data();
  const totalM = Math.floor((data.elapsedTime || 0) / 60).toString().padStart(2, '0');
  const s = ((data.elapsedTime || 0) % 60).toString().padStart(2, '0');
  const elapsedStr = `${totalM}:${s}`;

  const d = new Date(data.updatedAt || Date.now());
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

  return {
    id: docSnap.id,
    ...data,
    rawUpdatedAt: data.updatedAt || 0,
    elapsedStr,
    updatedAt: `${dateStr} ${timeStr}`
  };
}

/* ==========================================================================
   순위 (20문제 · 30초 타임어택)
   - 사람·도메인마다 문서 하나(`uid_domain`)에 본인 최고 기록 1개만 둔다.
   - 20문제: 정답률 높은 순, 같으면 빨리 끝낸 순. 문제 수가 정확히 20개인 판만 받는다.
   - 30초: 정답률 높은 순, 같으면 맞힌 수 많은 순(마구 눌러 맞힌 수만 많은 기록이 위로 오지 않게).
   ========================================================================== */
export const SPEEDRUN_RANKING_QUESTION_COUNT = 20;

const compareSpeedrun = (a, b) =>
  ((b.accuracy || 0) - (a.accuracy || 0)) || ((a.elapsedTime || 0) - (b.elapsedTime || 0)) || ((a.rawUpdatedAt ?? a.updatedAt ?? 0) - (b.rawUpdatedAt ?? b.updatedAt ?? 0));
const compareTimeAttack = (a, b) =>
  ((b.accuracy || 0) - (a.accuracy || 0)) || ((b.correctCount || 0) - (a.correctCount || 0)) || ((a.rawUpdatedAt ?? a.updatedAt ?? 0) - (b.rawUpdatedAt ?? b.updatedAt ?? 0));

/** 좋은 순으로 늘어놓고 사람·도메인마다 첫 기록만 남긴다(옛 문서가 남아 있어도 한 줄만 보이게) */
const keepBestPerPlayer = (rows, compare) => {
  const seen = new Set();
  return [...rows].sort(compare).filter((r) => {
    const key = `${r.uid}_${r.domain}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** 본인 최고 기록보다 좋을 때만 `uid_domain` 문서를 고쳐 쓴다. @returns {Promise<string|null>} 고쳐 썼으면 문서 ID */
const saveIfPersonalBest = async (collectionName, record, compare) => {
  const docId = `${currentUserUid}_${record.domain}`;
  const ref = doc(db, collectionName, docId);
  const snap = await getDoc(ref);
  if (snap.exists() && compare(record, snap.data()) >= 0) return null;
  await setDoc(ref, record);
  return docId;
};

/**
 * 20문제 타임어택 기록. 20문제가 아닌 판은 받지 않고, 본인 최고 기록보다 좋을 때만 고쳐 쓴다.
 * @returns {Promise<string|null>} 새 최고 기록이면 문서 ID
 */
export const submitSpeedrunRanking = async (rankingDomain, charCount, elapsedTime, accuracy, customName = null) => {
  if (!currentUserUid || charCount !== SPEEDRUN_RANKING_QUESTION_COUNT) return null;
  try {
    return await saveIfPersonalBest('namequiz_speedrun_rankings', {
      uid: currentUserUid,
      name: customName || document.getElementById('profile-name')?.innerText || '게스트',
      domain: rankingDomain,
      charCount,
      elapsedTime,
      accuracy,
      updatedAt: Date.now()
    }, compareSpeedrun);
  } catch (err) {
    console.warn('[LocalFirst] 스피드런 랭킹 등록 생략:', err.message);
    return null;
  }
};

/** 20문제 순위 (사람·도메인마다 최고 기록 1개) */
export const getGlobalRankings = async (limitCount = 10, targetFilter = 'all_sanrio') => {
  const rankingsRef = collection(db, 'namequiz_speedrun_rankings');
  const domainsToFetch = resolveLeaderboardQueryDomains(targetFilter);

  try {
    const snapshots = await Promise.all(
      domainsToFetch.map((dom) =>
        getDocs(query(rankingsRef, where('domain', '==', dom), orderBy('accuracy', 'desc'), orderBy('elapsedTime', 'asc'), limit(300)))
      )
    );
    const rows = snapshots
      .flatMap((snap) => snap.docs.map(formatRankingDoc))
      .filter((r) => r.charCount === SPEEDRUN_RANKING_QUESTION_COUNT);
    return keepBestPerPlayer(rows, compareSpeedrun).slice(0, limitCount);
  } catch (error) {
    console.error('[Leaderboard] 스피드런 랭킹 조회 실패:', error);
    return [];
  }
};

export const getStoredGuestId = () => localStorage.getItem(GUEST_ID_KEY);

export const findGuestProgressToMerge = () => {
  const guestId = getStoredGuestId();
  if (!guestId || !currentUserUid || currentUserUid === guestId) return null;

  const flagKey = `NAMEQUIZ_GUEST_MERGE_HANDLED_${guestId}_${currentUserUid}`;
  const lastHandledAt = Number(localStorage.getItem(flagKey)) || 0;

  let guestCache = {};
  try {
    guestCache = JSON.parse(localStorage.getItem(`NAMEQUIZ_PROGRESS_CACHE_${guestId}`) || '{}');
  } catch {
    return null;
  }

  const items = [];
  DOMAINS.forEach((domain) => {
    const chars = guestCache[domain];
    if (!chars || typeof chars !== 'object') return;
    Object.entries(chars).forEach(([key, guestData]) => {
      if (!guestData || !(guestData.stage > 0 || guestData.totalSolved > 0)) return;
      const accountData = progressCache[domain] ? progressCache[domain][key] : null;
      const guestTime = guestData.lastSessionTime || 0;
      const accountTime = accountData ? (accountData.lastSessionTime || 0) : -1;
      if (guestTime > lastHandledAt && guestTime > accountTime) {
        items.push({ domain, key, data: toPersistedSchema({ ...guestData, domain }) });
      }
    });
  });

  return { guestId, flagKey, items };
};

export const markGuestMergeHandled = (flagKey) => {
  try {
    localStorage.setItem(flagKey, String(Date.now()));
  } catch (e) {
    console.warn('[GuestMerge] 병합 처리 표시 저장 실패:', e);
  }
};

export const mergeGuestProgress = async (items) => {
  if (!currentUserUid || !items || items.length === 0) return 0;

  const now = Date.now();
  const byDomain = {};

  items.forEach(({ domain, key, data }) => {
    if (!progressCache[domain]) progressCache[domain] = {};
    const merged = { ...data, updatedAt: now };
    progressCache[domain][key] = merged;
    progressMeta[domain] = now;
    (byDomain[domain] = byDomain[domain] || []).push({ key, merged });
  });
  _saveLocalProgressCache();

  try {
    await Promise.all(Object.entries(byDomain).map(async ([domain, domainItems]) => {
      const batch = writeBatch(db);
      domainItems.forEach(({ key, merged }) => {
        batch.set(doc(db, 'users', currentUserUid, 'progress', domain, 'chars', key), merged);
      });
      batch.set(doc(db, 'users', currentUserUid), { namequizProgressMeta: { [domain]: now } }, { merge: true });
      await batch.commit();
    }));
  } catch (err) {
    console.warn('[GuestMerge] 서버 저장 생략:', err.message);
  }

  return items.length;
};

/* ==========================================================================
   콤보 기록 (학습 모드)
   - 날마다 최대 콤보: users/{uid}/study_stats/{날짜}.namequizMaxCombo (그날 가장 길게 이어진 정답 수)
   - 역대 최대 콤보: users/{uid}.namequizCombo = { current, best, bestAt }
     current 는 학습 판·날짜가 바뀌어도 이어지는 연속 정답 수(틀리면 0), best 는 그 최댓값.
   - 로컬 우선: NAMEQUIZ_COMBO_{uid} 에 { current, best, bestAt, daily: {날짜: 최대} } 를 먼저 적는다.
   ========================================================================== */
const comboStorageKey = () => `NAMEQUIZ_COMBO_${currentUserUid}`;

function readLocalCombo() {
  try {
    return JSON.parse(localStorage.getItem(comboStorageKey()) || 'null') || { current: 0, best: 0, bestAt: null, daily: {} };
  } catch {
    return { current: 0, best: 0, bestAt: null, daily: {} };
  }
}

function writeLocalCombo(value) {
  try {
    localStorage.setItem(comboStorageKey(), JSON.stringify(value));
  } catch {
    /* 무시 */
  }
}

/**
 * 이어지는 콤보 상태(역대 최대 포함). 서버와 로컬 중 큰 best 를 쓰고, current 는 더 최근에 적힌 쪽을 쓴다.
 * @returns {Promise<{current: number, best: number, bestAt: string|null}>}
 */
export const loadComboState = async () => {
  if (!currentUserUid) return { current: 0, best: 0, bestAt: null };
  const local = readLocalCombo();
  let server = null;
  try {
    const snap = await getDoc(doc(db, 'users', currentUserUid));
    server = snap.exists() ? snap.data().namequizCombo || null : null;
  } catch (err) {
    console.warn('[Combo] 서버 콤보 기록을 읽지 못했습니다:', err.message);
  }
  if (!server) return { current: local.current || 0, best: local.best || 0, bestAt: local.bestAt || null };
  const useServerCurrent = (server.updatedAt || 0) > (local.updatedAt || 0);
  const bestFromServer = (server.best || 0) >= (local.best || 0);
  return {
    current: useServerCurrent ? server.current || 0 : local.current || 0,
    best: Math.max(server.best || 0, local.best || 0),
    bestAt: bestFromServer ? server.bestAt || null : local.bestAt || null
  };
};

/**
 * 학습 한 판이 끝났을 때 콤보 기록을 남긴다.
 * @param {number} sessionMaxCombo 이번 판에서 가장 길게 이어진 정답 수
 * @param {{current: number, best: number, bestAt: string|null}} state 이어지는 콤보 상태
 */
export const saveComboStats = async (sessionMaxCombo, state) => {
  if (!currentUserUid) return;
  const today = toLocalDateKey();
  const now = Date.now();
  const local = readLocalCombo();
  local.daily = local.daily || {};
  local.daily[today] = Math.max(local.daily[today] || 0, sessionMaxCombo);
  Object.assign(local, { current: state.current, best: state.best, bestAt: state.bestAt, updatedAt: now });
  writeLocalCombo(local);

  try {
    await setDoc(doc(db, 'users', currentUserUid), {
      namequizCombo: { current: state.current, best: state.best, bestAt: state.bestAt, updatedAt: now }
    }, { merge: true });
    if (sessionMaxCombo > 0) {
      const statsRef = doc(db, 'users', currentUserUid, 'study_stats', today);
      const snap = await getDoc(statsRef);
      const prev = snap.exists() ? Number(snap.data().namequizMaxCombo) || 0 : 0;
      if (sessionMaxCombo > prev) await setDoc(statsRef, { namequizMaxCombo: sessionMaxCombo, lastUpdated: now }, { merge: true });
    }
  } catch (err) {
    console.warn('[Combo] 콤보 기록 서버 저장 생략(로컬 보존):', err.message);
  }
};

/**
 * 기간별 최대 콤보.
 * @param {'week'|'month'|'year'} range 주 = 최근 7일, 월 = 최근 30일(날마다), 년 = 최근 12달(달마다 최대)
 * @returns {Promise<Array<{key: string, label: string, value: number}>>}
 */
export const getComboHistory = async (range = 'week') => {
  if (!currentUserUid) return [];
  const dayCount = range === 'year' ? 366 : range === 'month' ? 30 : 7;
  const days = getRecentLocalDateKeys(dayCount);
  const daily = { ...(readLocalCombo().daily || {}) };

  try {
    const snap = await getDocs(query(
      collection(db, 'users', currentUserUid, 'study_stats'),
      where(documentId(), '>=', days[0])
    ));
    snap.forEach((d) => {
      const v = Number(d.data().namequizMaxCombo) || 0;
      if (v > (daily[d.id] || 0)) daily[d.id] = v;
    });
  } catch (err) {
    console.warn('[Combo] 서버 콤보 이력을 읽지 못했습니다(로컬 값만 사용):', err.message);
  }

  if (range !== 'year') {
    return days.map((key) => ({ key, label: key.slice(5).replace('-', '/'), value: daily[key] || 0 }));
  }
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
  }
  return months.map((key) => ({
    key,
    label: `${Number(key.slice(5))}월`,
    value: Math.max(0, ...Object.entries(daily).filter(([d]) => d.startsWith(key)).map(([, v]) => v))
  }));
};

/**
 * 이 기기에서 게스트로 쌓은 콤보 기록을 로그인한 계정에 합친다. 역대 최대와 날마다 최대는 큰 쪽을 남긴다.
 * 이어지는 콤보(current)는 계정 쪽을 그대로 둔다.
 * @returns {Promise<boolean>} 합친 것이 있으면 true
 */
export const mergeGuestCombo = async () => {
  const guestId = getStoredGuestId();
  if (!guestId || !currentUserUid || currentUserUid === guestId) return false;
  let guest;
  try {
    guest = JSON.parse(localStorage.getItem(`NAMEQUIZ_COMBO_${guestId}`) || 'null');
  } catch {
    guest = null;
  }
  if (!guest || !(guest.best > 0)) return false;

  const account = await loadComboState();
  const local = readLocalCombo();
  local.daily = local.daily || {};
  const raisedDays = [];
  Object.entries(guest.daily || {}).forEach(([day, value]) => {
    if (value > (local.daily[day] || 0)) {
      local.daily[day] = value;
      raisedDays.push([day, value]);
    }
  });
  const bestFromGuest = guest.best > (account.best || 0);
  if (!bestFromGuest && raisedDays.length === 0) return false;
  const state = {
    current: account.current || 0,
    best: bestFromGuest ? guest.best : account.best || 0,
    bestAt: bestFromGuest ? guest.bestAt : account.bestAt || null
  };
  Object.assign(local, state, { updatedAt: Date.now() });
  writeLocalCombo(local);

  try {
    await setDoc(doc(db, 'users', currentUserUid), { namequizCombo: { ...state, updatedAt: Date.now() } }, { merge: true });
    await Promise.all(raisedDays.map(async ([day, value]) => {
      const ref = doc(db, 'users', currentUserUid, 'study_stats', day);
      const snap = await getDoc(ref);
      if (value > (snap.exists() ? Number(snap.data().namequizMaxCombo) || 0 : 0)) {
        await setDoc(ref, { namequizMaxCombo: value, lastUpdated: Date.now() }, { merge: true });
      }
    }));
  } catch (err) {
    console.warn('[GuestMerge] 콤보 기록 서버 저장 생략(로컬 반영):', err.message);
  }
  return true;
};

/**
 * 30초 타임어택 기록. 기록 모드 30초와, 학습 시간을 30초로 두고 끝까지 한 학습 모드가 함께 쓴다.
 * 본인 최고 기록(정답률 → 맞힌 수)보다 좋을 때만 고쳐 쓴다.
 * @returns {Promise<string|null>} 새 최고 기록이면 문서 ID
 */
export const submitTimeAttackRanking = async (rankingDomain, correctCount, solvedCount, accuracy, customName = null) => {
  if (!currentUserUid || !(solvedCount > 0)) return null;
  try {
    return await saveIfPersonalBest('namequiz_timeattack_rankings', {
      uid: currentUserUid,
      name: customName || document.getElementById('profile-name')?.innerText || '게스트',
      domain: rankingDomain,
      correctCount,
      solvedCount,
      accuracy,
      durationSec: 30,
      updatedAt: Date.now()
    }, compareTimeAttack);
  } catch (err) {
    console.warn('[Leaderboard] 30초 타임어택 기록 등록 생략:', err.message);
    return null;
  }
};

/**
 * 30초 타임어택 순위. 정답률 높은 순, 같으면 맞힌 수 많은 순. 사람·도메인마다 최고 기록 1개.
 * 복합 인덱스 없이 정답률 순으로 넉넉히 읽고 도메인은 화면에서 거른다.
 */
export const getTimeAttackRankings = async (limitCount = 10, targetFilter = 'all_sanrio') => {
  const domains = new Set(resolveLeaderboardQueryDomains(targetFilter));
  try {
    const snap = await getDocs(query(collection(db, 'namequiz_timeattack_rankings'), orderBy('accuracy', 'desc'), limit(500)));
    const rows = snap.docs.map(formatRankingDoc).filter((r) => domains.has(r.domain));
    return keepBestPerPlayer(rows, compareTimeAttack)
      .slice(0, limitCount)
      .map((r) => ({ ...r, elapsedStr: '00:30' }));
  } catch (error) {
    console.error('[Leaderboard] 30초 타임어택 순위 조회 실패:', error);
    return [];
  }
};

/* ==========================================================================
   학습 정답률 기록 (목표 정답률 자동 진도, components/adaptive-progress.js)
   계정 문서(users/{uid})의 `namequizStudyAccuracy` 필드에 { log: [0|1...], updatedAt } 로 둔다.
   설정(config)은 기기에 저장본이 있으면 서버를 읽지 않으므로, 기기끼리 맞추려고 따로 둔다.
   ========================================================================== */
const STUDY_ACCURACY_FIELD = 'namequizStudyAccuracy';

/** 지금 기록 주인(계정 uid 또는 게스트 ID) */
export const getCurrentUserKey = () => currentUserUid;

const isSignedInOwner = () => Boolean(currentUserUid && auth.currentUser && auth.currentUser.uid === currentUserUid);

/** 계정에 저장된 정답률 기록을 읽는다(게스트·실패면 null) */
export const loadAccountStudyAccuracy = async () => {
  if (!isSignedInOwner()) return null;
  try {
    const snap = await getDoc(doc(db, 'users', currentUserUid));
    return snap.exists() ? (snap.data()[STUDY_ACCURACY_FIELD] || null) : null;
  } catch (e) {
    console.warn('[LocalFirst] 정답률 기록 불러오기 실패:', e.message);
    return null;
  }
};

/** 정답률 기록을 계정에 올린다(게스트면 하지 않음) */
export const saveAccountStudyAccuracy = async (state) => {
  if (!isSignedInOwner() || !state || !Array.isArray(state.log)) return;
  try {
    await setDoc(doc(db, 'users', currentUserUid), { [STUDY_ACCURACY_FIELD]: { log: state.log, updatedAt: state.updatedAt || Date.now() } }, { merge: true });
  } catch (e) {
    console.warn('[LocalFirst] 정답률 기록 저장 실패:', e.message);
  }
};
