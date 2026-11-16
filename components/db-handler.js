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

const GUEST_ID_KEY = 'NAMEQUIZ_GUEST_ID';
const WEEKLY_STATS_CACHE_TTL_MS = 10 * 60 * 1000;

let currentUserUid = null;
let progressCache = {};
let progressMeta = {};
let weeklyServerStatsCache = { uid: null, fetchedAt: 0, byDay: {} };

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

const _fetchServerWeeklyStats = async (dayKeys) => {
  const isCacheValid = weeklyServerStatsCache.uid === currentUserUid &&
    (Date.now() - weeklyServerStatsCache.fetchedAt) < WEEKLY_STATS_CACHE_TTL_MS;
  if (isCacheValid) return weeklyServerStatsCache.byDay;

  const byDay = {};
  try {
    const statsRef = collection(db, 'users', currentUserUid, 'study_stats');
    const q = query(
      statsRef,
      where(documentId(), '>=', dayKeys[0]),
      where(documentId(), '<=', dayKeys[dayKeys.length - 1])
    );
    const snapshot = await getDocs(q);
    snapshot.forEach((docSnap) => {
      byDay[docSnap.id] = docSnap.data();
    });
    weeklyServerStatsCache = { uid: currentUserUid, fetchedAt: Date.now(), byDay };
  } catch (err) {
    console.warn('[LocalFirst] 주간 학습통계 서버 조회 생략:', err.message);
  }
  return byDay;
};

export const getWeeklyStats = async (domain = 'sanrio') => {
  if (!currentUserUid || !domain) return { total: 0, history: {} };

  const stats = { total: 0, history: {} };
  const days = getRecentLocalDateKeys(7);

  let localStats = {};
  try {
    const rawStats = localStorage.getItem(`NAMEQUIZ_STUDY_STATS_${currentUserUid}`);
    localStats = rawStats ? JSON.parse(rawStats) : {};
  } catch (e) {
    console.warn('[LocalFirst] 주간 학습통계 로컬 계산 실패:', e);
  }

  const serverStats = await _fetchServerWeeklyStats(days);
  days.forEach((dayStr) => {
    const localSeconds = (localStats[dayStr] && localStats[dayStr][domain]) || 0;
    const serverSeconds = (serverStats[dayStr] && serverStats[dayStr][domain]) || 0;
    const seconds = Math.max(localSeconds, serverSeconds);
    stats.history[dayStr] = seconds;
    stats.total += seconds;
  });

  return stats;
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

export const submitSpeedrunRanking = async (rankingDomain, charCount, elapsedTime, accuracy, customName = null) => {
  if (!currentUserUid) return null;

  const displayName = customName || document.getElementById('profile-name')?.innerText || '게스트';
  const docId = `${currentUserUid}_${rankingDomain}_${Date.now()}`;
  const docRef = doc(db, 'speedrun_rankings', docId);

  try {
    await setDoc(docRef, {
      uid: currentUserUid,
      name: displayName,
      domain: rankingDomain,
      charCount,
      elapsedTime,
      accuracy,
      updatedAt: Date.now()
    });
    return docId;
  } catch (err) {
    console.warn('[LocalFirst] 스피드런 랭킹 등록 생략:', err.message);
    return null;
  }
};

export const getGlobalRankings = async (limitCount = 10, targetFilter = 'all_sanrio') => {
  const rankingsRef = collection(db, 'speedrun_rankings');
  const domainsToFetch = resolveLeaderboardQueryDomains(targetFilter);

  try {
    const snapshots = await Promise.all(
      domainsToFetch.map((dom) =>
        getDocs(query(rankingsRef, where('domain', '==', dom), orderBy('accuracy', 'desc'), orderBy('elapsedTime', 'asc'), limit(limitCount)))
      )
    );
    const merged = snapshots.flatMap((snap) => snap.docs.map(formatRankingDoc));
    merged.sort((a, b) => {
      if (b.accuracy !== a.accuracy) return (b.accuracy || 0) - (a.accuracy || 0);
      if (a.elapsedTime !== b.elapsedTime) return (a.elapsedTime || 0) - (b.elapsedTime || 0);
      return (a.rawUpdatedAt || 0) - (b.rawUpdatedAt || 0);
    });
    return merged.slice(0, limitCount);
  } catch (error) {
    console.error('[Leaderboard] 스피드런 랭킹 조회 실패:', error);
    return [];
  }
};

export const submitStudyRanking = async (rankingDomain, correctCount, elapsedTime, accuracy, customName = null) => {
  if (!currentUserUid || correctCount <= 0) return false;

  const displayName = customName || document.getElementById('profile-name')?.innerText || '게스트';
  const docId = `${currentUserUid}_${rankingDomain}`;
  const docRef = doc(db, 'study_rankings', docId);

  try {
    const docSnap = await getDoc(docRef);
    let shouldUpdate = false;

    if (docSnap.exists()) {
      const data = docSnap.data();
      const existingCorrect = data.correctCount || 0;
      const existingTime = data.elapsedTime || Infinity;
      if (correctCount > existingCorrect || (correctCount === existingCorrect && elapsedTime < existingTime)) {
        shouldUpdate = true;
      }
    } else {
      shouldUpdate = true;
    }

    if (shouldUpdate) {
      await setDoc(docRef, {
        uid: currentUserUid,
        name: displayName,
        domain: rankingDomain,
        correctCount,
        elapsedTime,
        accuracy,
        updatedAt: Date.now()
      });
      return true;
    }
    return false;
  } catch (error) {
    console.warn('[LocalFirst] 학습모드 랭킹 저장 생략:', error.message);
    return false;
  }
};

export const getStudyRankings = async (limitCount = 10, targetFilter = 'all_sanrio') => {
  const rankingsRef = collection(db, 'study_rankings');
  const domainsToFetch = resolveLeaderboardQueryDomains(targetFilter);

  try {
    const snapshots = await Promise.all(
      domainsToFetch.map((dom) =>
        getDocs(query(rankingsRef, where('domain', '==', dom), orderBy('correctCount', 'desc'), orderBy('elapsedTime', 'asc'), limit(limitCount)))
      )
    );
    const merged = snapshots.flatMap((snap) => snap.docs.map(formatRankingDoc));
    merged.sort((a, b) => {
      if (b.correctCount !== a.correctCount) return (b.correctCount || 0) - (a.correctCount || 0);
      if (a.elapsedTime !== b.elapsedTime) return (a.elapsedTime || 0) - (b.elapsedTime || 0);
      return (a.rawUpdatedAt || 0) - (b.rawUpdatedAt || 0);
    });
    return merged.slice(0, limitCount);
  } catch (error) {
    console.error('[Leaderboard] 학습 랭킹 조회 실패:', error);
    return [];
  }
};

export const submitSuggestion = async (text) => {
  if (!currentUserUid) return;

  const docRef = doc(db, 'suggestions', currentUserUid);
  const docSnap = await getDoc(docRef);
  const existingData = docSnap.exists() ? docSnap.data() : {};

  const suggestionHistory = existingData.suggestionHistory || [];
  suggestionHistory.push({
    app: 'NameQuiz',
    text,
    timestamp: Date.now()
  });

  const displayName = (auth && auth.currentUser)
    ? (auth.currentUser.displayName || '이름 없음')
    : (localStorage.getItem(GUEST_ID_KEY) || '게스트');
  const email = (auth && auth.currentUser) ? (auth.currentUser.email || '') : '';

  await setDoc(docRef, {
    uid: currentUserUid,
    name: displayName,
    email,
    suggestion: `[NameQuiz] ${text}`,
    suggestionHistory,
    reply: existingData.reply || '',
    updatedAt: Date.now()
  }, { merge: true });
};

export const getUserSuggestion = async () => {
  if (!currentUserUid) return null;
  try {
    const docSnap = await getDoc(doc(db, 'suggestions', currentUserUid));
    return docSnap.exists() ? docSnap.data() : null;
  } catch {
    return null;
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
