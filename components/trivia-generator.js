/**
 * @file components/trivia-generator.js
 * @description 산리오(40종) 및 캐치! 티니핑(179종) 프로필 메타데이터 기반 '질문(Trivia)' 4지선다 출제 엔진.
 * 긍정형("다음 중 ~인 캐릭터는?")과 부정형("다음 중 ~이 아닌 것은?") 문항을 오답 모호성 0%로 동적 생성합니다.
 */

import { getCharacters } from './character-data.js';

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 기본 이름(koName)이 서로 겹치지 않도록 후보군에서 count개를 무작위 추출한다.
 */
function pickUniqueNamedItems(candidates, count, initialUsedNames = new Set(), initialUsedIds = new Set()) {
  const usedNames = new Set(initialUsedNames);
  const usedIds = new Set(initialUsedIds);
  const picked = [];

  for (const item of shuffle(candidates)) {
    if (picked.length >= count) break;
    if (usedIds.has(item.charId) || usedNames.has(item.koName)) continue;
    usedIds.add(item.charId);
    usedNames.add(item.koName);
    picked.push(item);
  }
  return picked.length === count ? picked : null;
}

const SERIES_SEASON_MAP = [
  ['쥬얼스타 캐치! 티니핑', '7기'],
  ['프린세스 캐치! 티니핑', '6기'],
  ['슈팅스타 캐치! 티니핑', '5기'],
  ['새콤달콤 캐치! 티니핑', '4기'],
  ['알쏭달쏭 캐치! 티니핑', '3기'],
  ['반짝반짝 캐치! 티니핑', '2기'],
  ['캐치! 티니핑', '1기']
];

function inferEpisodeSeason(seriesText, fallbackSeason) {
  for (const [seriesName, sLabel] of SERIES_SEASON_MAP) {
    if (seriesText.includes(seriesName)) return sLabel;
  }
  return (fallbackSeason && fallbackSeason !== '극장판') ? fallbackSeason : '';
}

/**
 * 티니핑 첫 등장 문자열을 자연스러운 질문 문구로 변환한다.
 * 예: ("1기", "눈물사탕은 어떤 맛?(캐치! 티니핑 10화)") -> "1기 10화 「눈물사탕은 어떤 맛?」"
 */
export function formatTeeniepingEpisode(season, rawAppear) {
  const text = String(rawAppear || '').trim();
  if (!text) return '';

  const match = text.match(/^(.+?)\((.+?)\s*(\d+화)\)$/);
  if (match) {
    const epTitle = match[1].trim();
    const seriesPart = match[2].trim();
    const epNum = match[3].trim();
    const resolvedSeason = inferEpisodeSeason(seriesPart, season);
    const prefix = resolvedSeason ? `${resolvedSeason} ${epNum}` : epNum;
    return `${prefix} 「${epTitle}」`;
  }

  const directEpMatch = text.match(/^(.+?)\s+(\d+화)$/);
  if (directEpMatch) {
    const seriesPart = directEpMatch[1].trim();
    const epNum = directEpMatch[2].trim();
    const resolvedSeason = inferEpisodeSeason(seriesPart, season);
    return resolvedSeason ? `${resolvedSeason} ${epNum} (${seriesPart})` : `${seriesPart} ${epNum}`;
  }

  return `「${text}」`;
}

/**
 * 산리오 도메인 질문 생성기 목록
 */
function buildSanrioGenerators(allChars) {
  const generators = [];

  // 1. 생일 맞추기 (긍정형)
  generators.push(() => {
    const validTargets = allChars.filter((c) => c.birthday && c.birthday !== '불명');
    const target = pickRandom(validTargets);
    if (!target) return null;

    const distractorPool = allChars.filter((c) => c.birthday !== target.birthday);
    const distractors = pickUniqueNamedItems(distractorPool, 3, new Set([target.koName]), new Set([target.charId]));
    if (!distractors) return null;

    return {
      signature: `sanrio:bday:${target.charId}`,
      categoryChip: '🎂 생일 퀴즈',
      promptText: `다음 중 '${target.birthday}'이 생일인 산리오 캐릭터는?`,
      target,
      distractors,
      explanation: `${target.koName}의 생일은 ${target.birthday}입니다.`
    };
  });

  // 2. 출생지 맞추기 (긍정형 - 캐릭터 이름이 출생지에 그대로 들어간 경우 제외하여 스포일러 방지)
  generators.push(() => {
    const validTargets = allChars.filter((c) => {
      if (!c.birthplace || c.birthplace === '불명') return false;
      const pureKo = c.koName.replace(/\(.*\)/, '').trim();
      return !c.birthplace.includes(pureKo);
    });
    const target = pickRandom(validTargets);
    if (!target) return null;

    const distractorPool = allChars.filter((c) => c.birthplace !== target.birthplace);
    const distractors = pickUniqueNamedItems(distractorPool, 3, new Set([target.koName]), new Set([target.charId]));
    if (!distractors) return null;

    return {
      signature: `sanrio:place:${target.charId}`,
      categoryChip: '📍 출생지 퀴즈',
      promptText: `다음 중 출생지가 '${target.birthplace}'인 산리오 캐릭터는?`,
      target,
      distractors,
      explanation: `${target.koName}의 출생지는 '${target.birthplace}'입니다.`
    };
  });

  // 3. 출시연도 맞추기 (긍정형)
  generators.push(() => {
    const validTargets = allChars.filter((c) => c.debutYear && c.debutYear !== '불명');
    const target = pickRandom(validTargets);
    if (!target) return null;

    const distractorPool = allChars.filter((c) => c.debutYear !== target.debutYear);
    const distractors = pickUniqueNamedItems(distractorPool, 3, new Set([target.koName]), new Set([target.charId]));
    if (!distractors) return null;

    return {
      signature: `sanrio:year:${target.charId}`,
      categoryChip: '📅 출시연도 퀴즈',
      promptText: `다음 중 ${target.debutYear}년에 출시된 산리오 캐릭터는?`,
      target,
      distractors,
      explanation: `${target.koName}은(는) ${target.debutYear}년에 출시되었습니다.`
    };
  });

  // 4. 출시연도 부정형 ("다음 중 YYYY년에 출시된 캐릭터가 아닌 것은?")
  generators.push(() => {
    const byYear = {};
    allChars.forEach((c) => {
      if (c.debutYear && c.debutYear !== '불명') {
        (byYear[c.debutYear] = byYear[c.debutYear] || []).push(c);
      }
    });
    const multiYears = Object.keys(byYear).filter((y) => byYear[y].length >= 3);
    const refYear = pickRandom(multiYears);
    if (!refYear) return null;

    const distractors = pickUniqueNamedItems(byYear[refYear], 3);
    if (!distractors) return null;

    const usedNames = new Set(distractors.map((d) => d.koName));
    const targetPool = allChars.filter((c) => c.debutYear !== refYear && !usedNames.has(c.koName));
    const target = pickRandom(targetPool);
    if (!target) return null;

    return {
      signature: `sanrio:not_year:${refYear}:${target.charId}`,
      categoryChip: '📅 출시연도 퀴즈',
      promptText: `다음 중 ${refYear}년에 출시된 산리오 캐릭터가 아닌 것은?`,
      target,
      distractors,
      explanation: `${target.koName}은(는) ${target.debutYear}년 출시 캐릭터입니다. (나머지 보기는 ${refYear}년 출시)`
    };
  });

  // 5. 혈액형 맞추기 (긍정형)
  generators.push(() => {
    const validTargets = allChars.filter((c) => c.bloodType && c.bloodType !== '불명');
    const target = pickRandom(validTargets);
    if (!target) return null;

    const distractorPool = allChars.filter((c) => c.bloodType !== target.bloodType);
    const distractors = pickUniqueNamedItems(distractorPool, 3, new Set([target.koName]), new Set([target.charId]));
    if (!distractors) return null;

    return {
      signature: `sanrio:blood:${target.charId}`,
      categoryChip: '🩸 혈액형 퀴즈',
      promptText: `다음 중 혈액형이 '${target.bloodType}'인 산리오 캐릭터는?`,
      target,
      distractors,
      explanation: `${target.koName}의 혈액형은 ${target.bloodType}입니다.`
    };
  });

  // 6. 혈액형 부정형 (O형이 아닌 캐릭터 고르기)
  generators.push(() => {
    const oChars = allChars.filter((c) => c.bloodType === 'O형');
    if (oChars.length < 3) return null;
    const distractors = pickUniqueNamedItems(oChars, 3);
    if (!distractors) return null;

    const nonOKnown = allChars.filter((c) => c.bloodType && c.bloodType !== '불명' && c.bloodType !== 'O형');
    const target = pickRandom(nonOKnown);
    if (!target) return null;

    return {
      signature: `sanrio:not_blood_O:${target.charId}`,
      categoryChip: '🩸 혈액형 퀴즈',
      promptText: `다음 중 혈액형이 'O형'이 아닌 산리오 캐릭터는?`,
      target,
      distractors,
      explanation: `${target.koName}의 혈액형은 ${target.bloodType}입니다. (케로케로케로피·마이멜로디·턱시도샘은 O형)`
    };
  });

  return generators;
}

/**
 * 티니핑 도메인 질문 생성기 목록
 */
function buildTeeniepingGenerators(allChars, scopedChars, seasonFilter) {
  const generators = [];

  // 이름별 등장 시즌 집합 및 등급 집합 (다중 시즌 재등장 캐릭터 모호성 제거용)
  const seasonsByName = {};
  const gradesByName = {};
  allChars.forEach((c) => {
    (seasonsByName[c.koName] = seasonsByName[c.koName] || new Set()).add(c.season);
    if (c.grade && c.grade !== '기타') {
      (gradesByName[c.koName] = gradesByName[c.koName] || new Set()).add(c.grade);
    }
  });

  const activeSeasons = [...new Set(allChars.map((c) => c.season).filter(Boolean))];

  // 1. 시즌 부정형 ("다음 중 1기 캐릭터가 아닌 것은?")
  generators.push(() => {
    const preferredSeason = (seasonFilter && seasonFilter !== 'all') ? seasonFilter : pickRandom(activeSeasons);
    const refSeasonChars = allChars.filter((c) => c.season === preferredSeason && seasonsByName[c.koName]?.size === 1);
    if (refSeasonChars.length < 3) return null;

    const distractors = pickUniqueNamedItems(refSeasonChars, 3);
    if (!distractors) return null;

    const targetPool = allChars.filter(
      (c) => c.season !== preferredSeason && !seasonsByName[c.koName]?.has(preferredSeason)
    );
    const target = pickRandom(targetPool);
    if (!target) return null;

    const seasonLabel = preferredSeason === '극장판' ? '극장판' : `${preferredSeason}`;
    return {
      signature: `tp:not_season:${preferredSeason}:${target.charId}`,
      categoryChip: '📺 시즌 구별 퀴즈',
      promptText: `다음 중 ${seasonLabel} 캐릭터가 아닌 것은?`,
      target,
      distractors,
      explanation: `${target.koName}은(는) ${seasonLabel}가 아닌 ${target.season} 캐릭터입니다.`
    };
  });

  // 2. 시즌 긍정형 ("다음 중 N기 캐릭터인 것은?")
  generators.push(() => {
    const targetPool = scopedChars.filter((c) => seasonsByName[c.koName]?.size === 1);
    const target = pickRandom(targetPool);
    if (!target) return null;

    const distractorPool = allChars.filter(
      (c) => c.season !== target.season && !seasonsByName[c.koName]?.has(target.season)
    );
    const distractors = pickUniqueNamedItems(distractorPool, 3, new Set([target.koName]), new Set([target.charId]));
    if (!distractors) return null;

    return {
      signature: `tp:is_season:${target.season}:${target.charId}`,
      categoryChip: '📺 시즌 구별 퀴즈',
      promptText: `다음 중 '${target.season}'에 등장한 티니핑은?`,
      target,
      distractors,
      explanation: `${target.koName}은(는) ${target.season}${target.seasonTheme ? `(${target.seasonTheme})` : ''} 티니핑입니다.`
    };
  });

  // 3. 첫 등장 에피소드 맞추기 ("다음 중 1기 10화 「...」에 처음 등장한 티니핑은?")
  generators.push(() => {
    const validTargets = scopedChars.filter(
      (c) => c.firstAppear && c.firstAppear.trim() !== '' && c.grade !== '기타' && !(c.note && c.note.includes('모습'))
    );
    const target = pickRandom(validTargets);
    if (!target) return null;

    // 같은 시즌 오답을 우선 배치하여 변별력 향상 (부족 시 전체에서 보충)
    const sameSeasonDistractors = scopedChars.filter((c) => c.firstAppear !== target.firstAppear);
    let distractors = pickUniqueNamedItems(sameSeasonDistractors, 3, new Set([target.koName]), new Set([target.charId]));
    if (!distractors) {
      const globalDistractors = allChars.filter((c) => c.firstAppear !== target.firstAppear);
      distractors = pickUniqueNamedItems(globalDistractors, 3, new Set([target.koName]), new Set([target.charId]));
    }
    if (!distractors) return null;

    const epText = formatTeeniepingEpisode(target.season, target.firstAppear);
    return {
      signature: `tp:first_ep:${target.charId}`,
      categoryChip: '🎬 첫 등장 퀴즈',
      promptText: `다음 중 ${epText}에 처음 등장한 티니핑은?`,
      target,
      distractors,
      explanation: `${target.koName}의 첫 등장은 '${target.firstAppear}'입니다.`
    };
  });

  // 4. 등급 부정형 ("다음 중 로열 등급이 아닌 티니핑은?")
  generators.push(() => {
    const candidateGrades = ['로열', '일반', '레전드'];
    const refGrade = pickRandom(candidateGrades);

    const scopedSameGrade = scopedChars.filter((c) => c.grade === refGrade && gradesByName[c.koName]?.size === 1);
    const sourceSameGrade = scopedSameGrade.length >= 3
      ? scopedSameGrade
      : allChars.filter((c) => c.grade === refGrade && gradesByName[c.koName]?.size === 1);

    const distractors = pickUniqueNamedItems(sourceSameGrade, 3);
    if (!distractors) return null;

    const scopedDiffGrade = scopedChars.filter(
      (c) => c.grade && c.grade !== '기타' && c.grade !== refGrade && !gradesByName[c.koName]?.has(refGrade)
    );
    const sourceDiffGrade = scopedDiffGrade.length > 0
      ? scopedDiffGrade
      : allChars.filter((c) => c.grade && c.grade !== '기타' && c.grade !== refGrade && !gradesByName[c.koName]?.has(refGrade));

    const usedNames = new Set(distractors.map((d) => d.koName));
    const target = pickRandom(sourceDiffGrade.filter((c) => !usedNames.has(c.koName)));
    if (!target) return null;

    const gradeDesc = target.grade === '극장판'
      ? '극장판 티니핑'
      : `'${target.grade}' 등급(${target.season}) 티니핑`;
    return {
      signature: `tp:not_grade:${refGrade}:${target.charId}`,
      categoryChip: '👑 등급 구별 퀴즈',
      promptText: `다음 중 '${refGrade}' 등급이 아닌 티니핑은?`,
      target,
      distractors,
      explanation: `${target.koName}은(는) '${refGrade}' 등급이 아닌 ${gradeDesc}입니다.`
    };
  });

  // 5. 등급 긍정형 ("다음 중 일반/로열/레전드 등급인 티니핑은?")
  generators.push(() => {
    const candidateGrades = ['일반', '로열', '레전드'];
    const targetGrade = pickRandom(candidateGrades);

    const scopedTargets = scopedChars.filter((c) => c.grade === targetGrade && gradesByName[c.koName]?.size === 1);
    const sourceTargets = scopedTargets.length > 0
      ? scopedTargets
      : allChars.filter((c) => c.grade === targetGrade && gradesByName[c.koName]?.size === 1);

    const target = pickRandom(sourceTargets);
    if (!target) return null;

    const scopedNonGrade = scopedChars.filter(
      (c) => c.grade && c.grade !== '기타' && c.grade !== targetGrade && !gradesByName[c.koName]?.has(targetGrade)
    );
    const sourceNonGrade = scopedNonGrade.length >= 3
      ? scopedNonGrade
      : allChars.filter((c) => c.grade && c.grade !== '기타' && c.grade !== targetGrade && !gradesByName[c.koName]?.has(targetGrade));

    const distractors = pickUniqueNamedItems(sourceNonGrade, 3, new Set([target.koName]), new Set([target.charId]));
    if (!distractors) return null;

    return {
      signature: `tp:is_grade:${targetGrade}:${target.charId}`,
      categoryChip: '👑 등급 구별 퀴즈',
      promptText: `다음 중 '${targetGrade}' 등급인 티니핑은?`,
      target,
      distractors,
      explanation: `${target.koName}은(는) ${target.season} '${target.grade}' 등급 티니핑입니다.`
    };
  });

  // 6. 시즌 테마 부정형 ("다음 중 '디저트' 테마 티니핑이 아닌 것은?")
  generators.push(() => {
    const allThemes = [...new Set(allChars.map((c) => c.seasonTheme).filter(Boolean))];
    const refTheme = pickRandom(allThemes);
    if (!refTheme) return null;

    const sameThemeChars = allChars.filter((c) => c.seasonTheme === refTheme && seasonsByName[c.koName]?.size === 1);
    const distractors = pickUniqueNamedItems(sameThemeChars, 3);
    if (!distractors) return null;

    const usedNames = new Set(distractors.map((d) => d.koName));
    const diffThemeChars = allChars.filter(
      (c) => c.seasonTheme !== refTheme && seasonsByName[c.koName]?.size === 1 && !usedNames.has(c.koName)
    );
    const target = pickRandom(diffThemeChars);
    if (!target) return null;

    return {
      signature: `tp:not_theme:${refTheme}:${target.charId}`,
      categoryChip: '✨ 테마 구별 퀴즈',
      promptText: `다음 중 '${refTheme}' 테마 티니핑이 아닌 것은?`,
      target,
      distractors,
      explanation: `${target.koName}은(는) '${refTheme}' 테마가 아닌 ${target.season}${target.seasonTheme ? `(${target.seasonTheme})` : ''} 티니핑입니다.`
    };
  });

  return generators;
}

/**
 * 도메인과 시즌 범위에 맞춰 중복 없는 단일 질문(Trivia) 문항 객체를 생성한다.
 * @param {'sanrio'|'teenieping'} domain
 * @param {string} [seasonFilter='all']
 * @param {Set<string>} [usedSignatures=new Set()]
 * @returns {{
 *   questionType: 'trivia',
 *   signature: string,
 *   categoryChip: string,
 *   promptText: string,
 *   explanation: string,
 *   target: object,
 *   options: number[]
 * }}
 */
export function generateTriviaQuestion(domain = 'sanrio', seasonFilter = 'all', usedSignatures = new Set()) {
  const allChars = getCharacters(domain, 'all');
  const scopedChars = getCharacters(domain, seasonFilter);

  const generators = domain === 'teenieping'
    ? buildTeeniepingGenerators(allChars, scopedChars.length > 0 ? scopedChars : allChars, seasonFilter)
    : buildSanrioGenerators(allChars);

  for (let attempt = 0; attempt < 40; attempt++) {
    const gen = pickRandom(generators);
    const raw = gen ? gen() : null;
    if (!raw) continue;
    if (attempt < 30 && usedSignatures.has(raw.signature)) continue;

    usedSignatures.add(raw.signature);
    const options = shuffle([raw.target.charId, ...raw.distractors.map((d) => d.charId)]);
    return {
      questionType: 'trivia',
      signature: raw.signature,
      categoryChip: raw.categoryChip,
      promptText: raw.promptText,
      explanation: raw.explanation,
      target: raw.target,
      options
    };
  }

  // 극단적 폴백
  const fallbackTarget = scopedChars[0] || allChars[0];
  const fallbackDistractors = pickUniqueNamedItems(allChars, 3, new Set([fallbackTarget.koName]), new Set([fallbackTarget.charId])) || [];
  return {
    questionType: 'trivia',
    signature: `fallback:${fallbackTarget.charId}`,
    categoryChip: '❓ 캐릭터 퀴즈',
    promptText: `다음 중 '${fallbackTarget.koName}' 캐릭터를 고르세요.`,
    explanation: `정답은 ${fallbackTarget.koName}입니다.`,
    target: fallbackTarget,
    options: shuffle([fallbackTarget.charId, ...fallbackDistractors.map((d) => d.charId)])
  };
}
