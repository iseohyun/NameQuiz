/**
 * @file components/engine.js
 * @description 멀티 도메인(산리오·티니핑) 간격 반복 학습 풀 구성, 동일 이름 중복 배제 양방향 4지선다 출제 및 승급 알고리즘 엔진
 */

import { getCharacters } from './character-data.js';

export const INTERVALS = [1, 10, 30, 120, 1440, 4320, 10080, 21600, 43200]; // 단위: 분

const EARLY_RECALL_LATENCY_THRESHOLD_MS = 1500;
const MAX_RESPONSE_LATENCY_CAP_MS = 5000;
const MIN_REQUIRED_FOR_OPTIONS = 4;

export function isDueForReview(item, now = Date.now()) {
  if (!item || !(item.totalSolved > 0)) return false;
  const stage = item.stage || 0;
  const requiredMin = INTERVALS[stage] !== undefined ? INTERVALS[stage] : INTERVALS[INTERVALS.length - 1];
  const elapsedMin = (now - (item.lastSessionTime || 0)) / (60 * 1000);
  return elapsedMin >= requiredMin;
}

/**
 * 도메인(및 티니핑 시즌 필터) 캐릭터 목록에 DB 진도 데이터를 병합하여 반환한다.
 * @param {'sanrio'|'teenieping'} [domain='sanrio']
 * @param {object} [dbData={}]
 * @param {string} [seasonFilter='all']
 * @returns {Array<object>}
 */
export function buildMergedCharacterList(domain = 'sanrio', dbData = {}, seasonFilter = 'all') {
  const allCharacters = getCharacters(domain, seasonFilter);
  return allCharacters.map((meta) => {
    const saved = dbData[meta.charId] || dbData[String(meta.charId)] || {};
    return {
      ...meta,
      domain,
      stage: saved.stage !== undefined ? saved.stage : 0,
      recentLatencies: Array.isArray(saved.recentLatencies) ? [...saved.recentLatencies] : [],
      latenciesIdx: saved.latenciesIdx || 0,
      outCnt: saved.outCnt || 0,
      resetOutCnt: saved.resetOutCnt || 0,
      totalSolved: saved.totalSolved || 0,
      lastSessionTime: saved.lastSessionTime || 0,
      sessionStreak: saved.sessionStreak || 0,
      hasHistory: (saved.totalSolved || 0) > 0,
      isEligibleForPromotion: false,
      hasBeenPromotedThisSession: false
    };
  });
}

/**
 * 자동 진도 계획을 { newCount, force } 로 맞춘다. true/false(예전 방식)는 새 문항 1개/0개.
 * (계획은 components/adaptive-progress.js 의 planNewItems 가 최근 정답률로 정한다)
 */
function normalizeProgressPlan(autoProgress) {
  if (autoProgress && typeof autoProgress === 'object') {
    return { newCount: Math.max(0, Number(autoProgress.newCount) || 0), force: Boolean(autoProgress.force) };
  }
  return { newCount: autoProgress ? 1 : 0, force: false };
}

/**
 * [3단계] 새 문항을 넣는다. force 면 풀이 차 있어도 자리를 비운다:
 * 복습 때가 안 된 조기 보충 문항부터 빼고, 그래도 모자라면 뒤쪽 복습 문항을 다음 판으로 미룬다.
 */
function addNewItems(pool, processedData, plan, maxSize) {
  if (plan.newCount <= 0) return pool;
  const fresh = processedData.filter((item) => !item.hasHistory && !pool.some((p) => p.charId === item.charId));
  const take = plan.force ? plan.newCount : Math.min(plan.newCount, maxSize - pool.length);
  const picked = fresh.slice(0, Math.max(0, Math.min(take, maxSize)));
  if (picked.length === 0) return pool;
  let next = [...pool];
  let overflow = next.length + picked.length - maxSize;
  for (let i = next.length - 1; i >= 0 && overflow > 0; i--) {
    if (!next[i].isEligibleForPromotion) {
      next.splice(i, 1);
      overflow--;
    }
  }
  if (overflow > 0) next = next.slice(0, next.length - overflow);
  picked.forEach((item) => { item.isForcedNew = plan.force; });
  return next.concat(picked);
}

/**
 * autoProgress: true/false 또는 { newCount, force } (adaptive-progress.js 의 planNewItems)
 * 학습 모드 세션 진입 시 간격 반복 우선순위에 따라 출제 풀을 구성한다.
 */
export function initSessionPool(domain = 'sanrio', dbData = {}, autoProgress = true, MAX_POOL_SIZE = 10, seasonFilter = 'all') {
  const now = Date.now();
  const processedData = buildMergedCharacterList(domain, dbData, seasonFilter);
  const safeMaxPool = Math.min(processedData.length, Math.max(MIN_REQUIRED_FOR_OPTIONS, Number(MAX_POOL_SIZE) || 10));

  const getAvgLatency = (item) => {
    if (!item.recentLatencies || item.recentLatencies.length === 0) return 0;
    return item.recentLatencies.reduce((a, b) => a + b, 0) / item.recentLatencies.length;
  };

  // [1단계] 복습 주기를 채운 정식 복습 대상 수급
  const reviewCandidates = processedData.filter((item) => isDueForReview(item, now));
  reviewCandidates.forEach((item) => {
    item.isEligibleForPromotion = true;
  });
  reviewCandidates.sort((a, b) => {
    if (a.stage !== b.stage) return a.stage - b.stage;
    return getAvgLatency(b) - getAvgLatency(a);
  });

  let pool = reviewCandidates.slice(0, safeMaxPool);

  // [2단계] 반응속도가 느린 기학습 캐릭터 조기 보충
  if (pool.length < safeMaxPool) {
    const insufficientCandidates = processedData.filter((item) => {
      if (!item.hasHistory || pool.some((p) => p.charId === item.charId)) return false;
      return getAvgLatency(item) > EARLY_RECALL_LATENCY_THRESHOLD_MS;
    });
    insufficientCandidates.sort((a, b) => getAvgLatency(b) - getAvgLatency(a));
    pool = pool.concat(insufficientCandidates.slice(0, safeMaxPool - pool.length));
  }

  // [3단계] 자동진도: 미학습 신규 캐릭터 진입 (최근 정답률이 높으면 풀이 차 있어도 넣는다)
  pool = addNewItems(pool, processedData, normalizeProgressPlan(autoProgress), safeMaxPool);

  // [4단계] 최소 4종(서로 다른 이름 4종 확보 포함) 방어선
  const countUniqueNames = (arr) => new Set(arr.map((x) => x.koName)).size;

  if (pool.length < MIN_REQUIRED_FOR_OPTIONS || countUniqueNames(pool) < MIN_REQUIRED_FOR_OPTIONS) {
    const backupCandidates = processedData.filter((item) => item.hasHistory && !pool.some((p) => p.charId === item.charId));
    backupCandidates.sort((a, b) => getAvgLatency(b) - getAvgLatency(a));
    for (const cand of backupCandidates) {
      if (pool.length >= Math.max(MIN_REQUIRED_FOR_OPTIONS, safeMaxPool) && countUniqueNames(pool) >= MIN_REQUIRED_FOR_OPTIONS) break;
      pool.push(cand);
    }
  }

  if (pool.length < MIN_REQUIRED_FOR_OPTIONS || countUniqueNames(pool) < MIN_REQUIRED_FOR_OPTIONS) {
    const freshNewCandidates = processedData.filter((item) => !pool.some((p) => p.charId === item.charId));
    for (const cand of freshNewCandidates) {
      if (pool.length >= MIN_REQUIRED_FOR_OPTIONS && countUniqueNames(pool) >= MIN_REQUIRED_FOR_OPTIONS) break;
      pool.push(cand);
    }
  }

  if (pool.length > safeMaxPool && countUniqueNames(pool.slice(0, safeMaxPool)) >= MIN_REQUIRED_FOR_OPTIONS) {
    pool = pool.slice(0, safeMaxPool);
  }

  processedData.forEach((item) => {
    if (pool.some((p) => p.charId === item.charId)) {
      item.sessionStreak++;
    } else {
      item.sessionStreak = 0;
    }
  });

  return pool;
}

export function pickNextTarget(pool, lastCharId = null) {
  if (!pool || pool.length === 0) return null;
  if (pool.length === 1 || lastCharId === null) {
    return pool[Math.floor(Math.random() * pool.length)];
  }
  const candidates = pool.filter((item) => item.charId !== lastCharId);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * 타겟 캐릭터와 오답 후보 3종을 섞어 4지선다 문제를 생성한다.
 * 티니핑 내 동일 기본 이름(예: 시즌별 하츄핑 7종, 트러핑 2종 등)이 한 문제의 4지선다에 중복 등장하지 않도록 차단한다.
 */
export function generateFourOptions(targetItem, currentPool, quizDirection = 'mixed', domain = 'sanrio', seasonFilter = 'all') {
  const usedNames = new Set([targetItem.koName]);
  const usedIds = new Set([targetItem.charId]);
  const chosenDistractors = [];

  const pickDistinctFrom = (sourceList) => {
    const shuffled = [...sourceList].sort(() => Math.random() - 0.5);
    for (const item of shuffled) {
      if (chosenDistractors.length >= 3) break;
      if (usedIds.has(item.charId) || usedNames.has(item.koName)) continue;
      usedIds.add(item.charId);
      usedNames.add(item.koName);
      chosenDistractors.push(item);
    }
  };

  // 1순위: 현재 세션 풀 내에서 기본 이름이 겹치지 않는 오답 후보 추출
  pickDistinctFrom(currentPool);

  // 2순위: 부족할 경우 현재 시즌/도메인 전체 캐릭터에서 보충
  if (chosenDistractors.length < 3) {
    pickDistinctFrom(getCharacters(domain, seasonFilter));
  }

  // 3순위: 그래도 부족할 경우 도메인 전체 캐릭터에서 보충
  if (chosenDistractors.length < 3) {
    pickDistinctFrom(getCharacters(domain, 'all'));
  }

  const options = [targetItem.charId, ...chosenDistractors.map((d) => d.charId)].sort(() => Math.random() - 0.5);

  let questionType = 'img2name';
  if (quizDirection === 'name2img') {
    questionType = 'name2img';
  } else if (quizDirection === 'mixed') {
    questionType = Math.random() < 0.5 ? 'img2name' : 'name2img';
  }

  return { target: targetItem, options, questionType };
}

export function calculateReviewState(item, isCorrect, latency) {
  item.totalSolved++;
  item.lastSessionTime = Date.now();
  item.hasHistory = true;

  if (latency >= MAX_RESPONSE_LATENCY_CAP_MS) {
    const capped = MAX_RESPONSE_LATENCY_CAP_MS;
    item.resetOutCnt = 0;
    item.recentLatencies = item.recentLatencies || [];
    if (item.recentLatencies.length < 10) {
      item.recentLatencies.push(capped);
    } else {
      item.recentLatencies[item.latenciesIdx] = capped;
    }
    item.latenciesIdx = (item.latenciesIdx + 1) % 10;
    return item;
  }

  if (!isCorrect) {
    item.outCnt++;
    item.resetOutCnt = 0;

    if (item.outCnt >= 3) {
      item.stage = 0;
      item.outCnt = 0;
      item.resetOutCnt = 0;
      item.recentLatencies = [];
      item.latenciesIdx = 0;
      item.isEligibleForPromotion = false;
    }
    return item;
  }

  item.recentLatencies = item.recentLatencies || [];
  if (item.recentLatencies.length < 10) {
    item.recentLatencies.push(latency);
  } else {
    item.recentLatencies[item.latenciesIdx] = latency;
  }
  item.latenciesIdx = (item.latenciesIdx + 1) % 10;

  item.resetOutCnt++;
  if (item.resetOutCnt >= 3) {
    item.outCnt = Math.max(0, item.outCnt - 1);
    item.resetOutCnt = 0;
  }

  if (!item.isEligibleForPromotion) {
    if (item.stage === 0 && !item.hasBeenPromotedThisSession) {
      item.stage = 1;
      item.hasBeenPromotedThisSession = true;
    }
    return item;
  }

  if (item.recentLatencies.length < 10) {
    return item;
  }

  const avgLatency = item.recentLatencies.reduce((a, b) => a + b, 0) / item.recentLatencies.length;
  const margin = avgLatency * 0.2;

  if (latency > avgLatency + margin) {
    item.stage = Math.max(0, item.stage - 1);
  } else if (!item.hasBeenPromotedThisSession) {
    item.stage = Math.min(8, item.stage + 1);
    item.isEligibleForPromotion = false;
    item.hasBeenPromotedThisSession = true;
  }

  return item;
}
