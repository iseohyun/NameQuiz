/**
 * @file components/store.js
 * @description 사용자 환경설정(userConfig) 전역 상태 및 도메인/출제 유형(그림→이름→교차→질문)/시즌/이름 언어 옵션 상수 관리 모듈
 */

export const QUIZ_DIRECTIONS = ['img2name', 'name2img', 'mixed', 'trivia'];
export const QUIZ_DIRECTION_META = Object.freeze({
  img2name: {
    badge: '그림',
    icon: 'image',
    label: '캐릭터 → 이름 맞추기',
    shortSuffix: '그림→이름'
  },
  name2img: {
    badge: '이름',
    icon: 'badge',
    label: '이름 → 캐릭터 맞추기',
    shortSuffix: '이름→그림'
  },
  mixed: {
    badge: '교차',
    icon: 'shuffle',
    label: '혼합 출제 (그림↔이름)',
    shortSuffix: '혼합'
  },
  trivia: {
    badge: '질문',
    icon: 'quiz',
    label: '프로필 질문 퀴즈',
    shortSuffix: '질문'
  }
});

export const NAME_LANGS = ['ko', 'en', 'both'];
export const NAME_LANG_META = Object.freeze({
  ko: { badge: '한', label: '한국어 이름' },
  en: { badge: 'EN', label: '영문 이름 (English)' },
  both: { badge: '한·E', label: '한글 + 영문 병기' }
});

export const TRIVIA_COUNT_OPTIONS = [5, 10, 15, 20, 30];

export function buildRankingDomainKey(domain, teeniepingSeason = 'all', quizDirection = 'mixed') {
  const dirSuffix = QUIZ_DIRECTION_META[quizDirection]?.shortSuffix || '혼합';
  if (domain === 'teenieping') {
    const scopePrefix = (!teeniepingSeason || teeniepingSeason === 'all')
      ? 'teenieping'
      : `teenieping-${teeniepingSeason}`;
    return `${scopePrefix}(${dirSuffix})`;
  }
  return `sanrio(${dirSuffix})`;
}

export const userConfig = {
  learningTime: 60,
  MAX_POOL_SIZE: 10,
  autoProgress: true,
  currentDomain: 'sanrio',       // 'sanrio' | 'teenieping'
  teeniepingSeason: 'all',       // 'all' | '1기' ~ '7기' | '극장판'
  quizDirection: 'mixed',        // 'img2name' | 'name2img' | 'mixed' | 'trivia'
  triviaQuestionCount: 10,       // 질문(trivia) 모드 문항 수 (기본 10문항)
  triviaShowName: true,          // 질문(trivia) 모드 4지선다 보기에 캐릭터 그림 + 이름 병기 여부
  nameLang: 'ko',                // 'ko' | 'en' | 'both' (산리오 전용)
  errorFeedbackMode: 'show',     // 'show' | 'none'
  spectatorInterval: 2,          // 관전 모드 출력 주기 (초)
  age: '미상',
  gender: '미상',
  keybindings: {
    toggleDomain: { label: "도메인 변경 (산리오↔티니핑)", primary: "1", secondary: "d" },
    toggleQuizDirection: { label: "출제 방식 변경 (그림→이름→교차→질문)", primary: "2", secondary: "t" },
    popupProgress: { label: "도감/진도표 팝업", primary: "3", secondary: "p" },
    popupSetting: { label: "환경설정 팝업", primary: "4", secondary: "s" },
    popupLeaderboard: { label: "리더보드 팝업", primary: "5", secondary: "r" },
    popupHelp: { label: "도움말 팝업", primary: "9", secondary: "h" },
    popupLogin: { label: "로그인 팝업", primary: "Escape", secondary: "l" },
    startStudy: { label: "학습 모드 시작", primary: "q", secondary: "7" },
    startRecord: { label: "기록 모드 시작", primary: "w", secondary: "8" },
    startSpectator: { label: "관전 모드 시작", primary: "e", secondary: "6" },
    pauseResume: { label: "일시정지 / 재개", primary: "Space", secondary: "0" },
    option0: { label: "1번 답안 (좌상)", primary: "4", secondary: "a" },
    option1: { label: "2번 답안 (우상)", primary: "5", secondary: "s" },
    option2: { label: "3번 답안 (좌하)", primary: "1", secondary: "z" },
    option3: { label: "4번 답안 (우하)", primary: "2", secondary: "x" }
  }
};

export const TIME_STEPS = [20, 30, 40, 50, 60, 90];

const DEFAULT_USER_CONFIG = JSON.parse(JSON.stringify(userConfig));

export function resetUserConfig() {
  Object.keys(userConfig).forEach((key) => {
    if (!(key in DEFAULT_USER_CONFIG)) delete userConfig[key];
  });
  Object.assign(userConfig, JSON.parse(JSON.stringify(DEFAULT_USER_CONFIG)));
}

export function updateTimeFromSlider(val) {
  const targetTime = TIME_STEPS[val] || 60;
  userConfig.learningTime = targetTime;

  const display = document.getElementById('time-val-display');
  if (display) display.innerText = targetTime;
}

window.updateTimeFromSlider = updateTimeFromSlider;
