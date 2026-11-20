/**
 * @file main.js
 * @description NameQuiz 애플리케이션 메인 엔트리 포인트.
 * 산리오(40종) 및 캐치! 티니핑(179종, 시즌별 범위 선택) 4대 출제 방식(그림→이름→교차→질문),
 * 간격 반복 학습/기록/관전 모드, 질문 퀴즈 해설 리포트 모달 및 단축키 워크플로우를 총괄합니다.
 */

import './components/install-prompt.js'; // 설치 신호(beforeinstallprompt)를 일찍 받아 둔다
import {
  userConfig,
  resetUserConfig,
  TIME_STEPS,
  QUIZ_DIRECTIONS,
  QUIZ_DIRECTION_META,
  NAME_LANGS,
  NAME_LANG_META,
  TRIVIA_COUNT_OPTIONS,
  buildRankingDomainKey
} from './components/store.js';
import { getTrailingStreak, showCombo } from './components/combo-fx.js';
import {
  TARGET_ACCURACY_STEPS,
  DEFAULT_TARGET_ACCURACY,
  normalizeTargetAccuracy,
  planNewItems,
  recordStudyAnswer,
  getRecentStudyAccuracy
} from './components/adaptive-progress.js';
import { renderSisterAppsHtml, hydrateSisterApps } from './components/sister-apps.js';
import { toLocalDateKey } from './components/date-utils.js';
import { WEATHER_META, getApproxWeather } from './components/season-weather.js';
import { startWeatherLayer } from './components/weather-layer.js';
import { initSettingNewDot, hasUnseenVersion, markVersionSeen } from './components/new-dot.js';
import { refreshInstallButtons } from './components/install-prompt.js';
import { auth } from './components/firebase-config.js';
import {
  DOMAINS,
  DOMAIN_META,
  TEENIEPING_SEASONS,
  loadCharacterDataset,
  getCharacters,
  getCharacterById,
  getCharacterPlainName,
  getCharacterNameHtml,
  getCharacterProfileSpec,
  preloadCharacterImages,
  escapeHtml
} from './components/character-data.js';
import {
  initUser,
  getAllProgress,
  activateSingleCharInDb,
  resetSingleCharInDb,
  unlockAllCharactersInDb,
  resetAllProgressInDb,
  saveSessionPoolState,
  updateDailyStudyTime,
  getUserConfig,
  saveUserConfig,
  loadComboState,
  saveComboStats,
  getComboHistory,
  mergeGuestCombo,
  submitSpeedrunRanking,
  getGlobalRankings,
  submitTimeAttackRanking,
  getTimeAttackRankings,
  toPersistedSchema,
  findGuestProgressToMerge,
  markGuestMergeHandled,
  mergeGuestProgress
} from './components/db-handler.js';
import {
  generateKeybindingsHtml,
  bindKeybindingSettingsEvents,
  updateVisualBadges,
  registerGlobalKeybindings
} from './components/keybind-manager.js';
import {
  initSessionPool,
  pickNextTarget,
  generateFourOptions,
  calculateReviewState,
  isDueForReview,
  buildMergedCharacterList,
  INTERVALS
} from './components/engine.js';
import { generateTriviaQuestion } from './components/trivia-generator.js';
import { startUpdateChecker } from './components/update-checker.js';
import {
  getNotificationState,
  initNotificationToken,
  requestNotificationPermission,
  scheduleReviewNotification,
  getLastReminderResult
} from './components/notification-handler.js';
import { initNotificationInbox, openInboxModal, updateInboxBadge } from './components/notification-inbox.js';
import { openHintListModal, renderHintHallOfFame } from './components/hint-handler.js';
import {
  SEASON_META,
  getActiveSeasonTheme,
  cycleSeasonTheme,
  setSeasonTheme,
  startSeasonalStage,
  stopSeasonalStage
} from './components/seasonal-stage.js';
import {
  renderComboChart,
  renderResponseTimeChart,
  renderProgressTable,
  renderSeasonTabsInModal,
  getStageColor,
  toggleAnalysisMode,
  renderLeaderboardUI,
  openTriviaReportModal
} from './components/ui-modal-handler.js';
import {
  initAuthObserver,
  getActiveAuthProvider,
  getLoginSuccessHistory,
  recordLoginSuccess,
  formatUserEmailForDisplay,
  googleLogin,
  kakaoLogin,
  naverLogin,
  logoutUser
} from './components/auth-handler.js';

window.toggleAnalysisMode = toggleAnalysisMode;

const MIN_CLICK_LATENCY_MS = 120;
const OPTION_KEYBIND_HINTS = ['4 / A', '5 / S', '1 / Z', '2 / X'];

const PROVIDER_META = {
  google: { label: 'Google 계정', short: 'G', className: 'provider-google' },
  kakao: { label: '카카오 계정', short: 'K', className: 'provider-kakao' },
  naver: { label: '네이버 계정', short: 'N', className: 'provider-naver' }
};

let currentMode = 'study';
let currentPool = [];
let currentQuestion = null;
let lastTargetCharId = null;
let sessionHistory = [];
let spectatorIntervalId = null;
let lastSpectatorCharId = null;

let timeLeft = 60;
let timerInterval = null;
let questionStartTime = 0;

let isPaused = false;
let isTimeUp = false;
let isStartingSession = false;

// 기록 모드(스피드런) 및 질문(Trivia) 세트 전용 상태
// 캐릭터 기록 모드 한 판의 문제 수 상한. 보기(오답 후보)는 범위 전체에서 뽑는다.
const SPEEDRUN_MAX_QUESTIONS = 20;
const TIME_ATTACK_SECONDS = 30;
let srTimeAttack = false; // 기록 모드 「30초 타임어택」: 20문제 흐름을 쓰되 30초 동안 계속 내고 맞힌 수로 잰다
let taTimeLeft = 0;
let srElapsedTime = 0;
let srTotalCount = 0;
let srCurrentIndex = 0;
let srCorrectCount = 0;

let isTriviaSetSession = false;
let triviaSetLogs = [];
let usedTriviaSignatures = new Set();

function stopInfoCardFloatingChars() {
  stopSeasonalStage();
}

function startInfoCardFloatingChars() {
  const stageEl = document.getElementById('info-floating-stage');
  if (!stageEl) return;

  const domain = userConfig.currentDomain;
  const seasonFilter = getActiveSeasonFilter();
  const charsPool = getCharacters(domain, seasonFilter);
  startSeasonalStage(stageEl, charsPool);
  applyWeatherToInfoCard();
}

/* ---------- 계절 무대 위의 날씨 (QuizApp Common GUI 「계절·날씨 무대」) ---------- */
let infoCardWeather = null;
let weatherRequested = false;

/** 계절 배지 뒤에 붙는 날씨 글자. 설정에서 끄면 빈 글자 */
function weatherBadgeSuffix() {
  if (userConfig.weatherTheme === false || !infoCardWeather) return '';
  const meta = WEATHER_META[infoCardWeather.kind];
  if (!meta) return '';
  const icon = infoCardWeather.isDay ? meta.icon : (meta.nightIcon || meta.icon);
  return ` · ${icon} ${meta.label}${infoCardWeather.temp !== null ? ` ${infoCardWeather.temp}°` : ''}`;
}

function refreshSeasonBadge() {
  const badgeEl = document.getElementById('season-theme-badge');
  const meta = SEASON_META[getActiveSeasonTheme()];
  if (badgeEl && meta) badgeEl.innerText = `${meta.icon} ${meta.label}${weatherBadgeSuffix()}`;
}

/** 안내 카드에 날씨 층을 겹친다. 날씨는 처음 한 번만 받아 오고(1시간 저장), 받으면 다시 그린다 */
function applyWeatherToInfoCard() {
  const card = document.getElementById('info-floating-stage')?.closest('.mode-info-card');
  if (!card) return;
  const enabled = userConfig.weatherTheme !== false;
  startWeatherLayer(card, enabled ? infoCardWeather : null);
  refreshSeasonBadge();
  if (enabled && !weatherRequested) {
    weatherRequested = true;
    getApproxWeather().then((value) => {
      infoCardWeather = value;
      if (value) applyWeatherToInfoCard();
    });
  }
}

window.cycleInfoCardSeason = function (event) {
  if (event && event.target && ['SELECT', 'OPTION'].includes(event.target.tagName)) return;
  const nextTheme = cycleSeasonTheme();
  const meta = SEASON_META[nextTheme];
  const badgeEl = document.getElementById('season-theme-badge');
  if (badgeEl && meta) {
    badgeEl.innerText = `${meta.icon} ${meta.label}${weatherBadgeSuffix()}`;
    badgeEl.classList.remove('pulse-scale');
    void badgeEl.offsetWidth;
    badgeEl.classList.add('pulse-scale');
  }
  startInfoCardFloatingChars();
};

window.setInfoCardSeason = function (themeName) {
  const nextTheme = setSeasonTheme(themeName);
  const meta = SEASON_META[nextTheme];
  const badgeEl = document.getElementById('season-theme-badge');
  if (badgeEl && meta) badgeEl.innerText = `${meta.icon} ${meta.label}${weatherBadgeSuffix()}`;
  startInfoCardFloatingChars();
};

function getActiveSeasonFilter() {
  return userConfig.currentDomain === 'teenieping' ? (userConfig.teeniepingSeason || 'all') : 'all';
}

function getDefaultLeaderboardFilter() {
  if (userConfig.currentDomain === 'teenieping') {
    const s = userConfig.teeniepingSeason || 'all';
    return s === 'all' ? 'all_teenieping' : `scope:teenieping-${s}`;
  }
  return 'all_sanrio';
}

function buildMainSelectionHtml() {
  const domain = userConfig.currentDomain;
  const seasonFilter = getActiveSeasonFilter();
  const isTrivia = userConfig.quizDirection === 'trivia';
  const dirMeta = QUIZ_DIRECTION_META[userConfig.quizDirection] || QUIZ_DIRECTION_META.mixed;
  const langMeta = NAME_LANG_META[userConfig.nameLang] || NAME_LANG_META.ko;
  const scopedChars = getCharacters(domain, seasonFilter);
  const totalInScope = scopedChars.length;
  const triviaCnt = userConfig.triviaQuestionCount || 10;

  const seasonSelectorHtml = domain === 'teenieping'
    ? `<select class="info-season-select" aria-label="티니핑 시즌 범위 선택" onchange="changeTeeniepingSeasonQuick(this.value)">
         ${TEENIEPING_SEASONS.map((s) => `
           <option value="${escapeHtml(s.id)}" ${s.id === seasonFilter ? 'selected' : ''}>${escapeHtml(s.label)}</option>
         `).join('')}
       </select>`
    : `<span class="info-pill blue">${escapeHtml(langMeta.label)}</span>`;

  const domainHeadline = domain === 'teenieping'
    ? `NameQuiz · 티니핑 (${totalInScope}종)`
    : `NameQuiz · 산리오 (${totalInScope}종)`;

  const studyDesc = isTrivia
    ? `${triviaCnt}문항 프로필 질문 풀이 & 해설 리포트`
    : '간격 반복 양방향 퀴즈로 캐릭터 익히기';
  const recordDesc = isTrivia
    ? `${triviaCnt}문항 프로필 퀴즈 타임어택 순위 경쟁`
    : `${Math.min(totalInScope, SPEEDRUN_MAX_QUESTIONS)}문제 타임어택 속도 측정`;

  return `
    <div id="mode-selection-layer" class="mode-selection">
      <button type="button" class="mode-btn mode-study" onclick="startSessionWorkflow('study')">
        <div class="mode-btn-content">
          <span class="material-symbols-outlined mode-icon">${isTrivia ? 'quiz' : 'menu_book'}</span>
          <span class="mode-title">${isTrivia ? '질문 퀴즈' : '학습 모드'}</span>
          <span class="mode-desc">${escapeHtml(studyDesc)}</span>
        </div>
        <span class="keybind-badge" id="kb-badge-startStudy">Q</span>
      </button>

      <div class="mode-btn mode-record mode-split">
        <button type="button" class="mode-split-half" onclick="startSessionWorkflow('record')" title="${escapeHtml(recordDesc)}">
          <span class="material-symbols-outlined mode-split-icon">timer</span>
          <span class="mode-split-title">${isTrivia ? '질문 기록' : '20문제 타임어택'}</span>
          <span class="keybind-badge" id="kb-badge-startRecord">W</span>
        </button>
        <button type="button" class="mode-split-half" onclick="startSessionWorkflow('timeattack')">
          <span class="material-symbols-outlined mode-split-icon">avg_pace</span>
          <span class="mode-split-title">30초 타임어택</span>
        </button>
      </div>

      <button type="button" class="mode-btn mode-spectator" onclick="startSessionWorkflow('spectator')">
        <div class="mode-btn-content">
          <span class="material-symbols-outlined mode-icon">visibility</span>
          <span class="mode-title">관전 모드</span>
          <span class="mode-desc">일러스트와 프로필 카드 자동 슬라이드</span>
        </div>
        <span class="keybind-badge" id="kb-badge-startSpectator">E</span>
      </button>

      <div class="mode-info-card" ondblclick="cycleInfoCardSeason(event)" title="더블클릭하면 계절 테마(봄·여름·가을·겨울)가 바뀝니다">
        <div id="info-floating-stage" class="info-floating-stage" aria-hidden="true"></div>
        <span id="season-theme-badge" class="season-theme-badge">${SEASON_META[getActiveSeasonTheme()].icon} ${escapeHtml(SEASON_META[getActiveSeasonTheme()].label)}</span>
        <div class="info-card-overlay-content">
          <div class="info-card-text">
            <strong>${escapeHtml(domainHeadline)}</strong>
          </div>
          <div class="info-status-pills">
            <span class="info-pill">${escapeHtml(dirMeta.label)}</span>
            ${seasonSelectorHtml}
          </div>
        </div>
      </div>
    </div>
  `;
}

window.addEventListener('load', initApp);

async function initApp() {
  // 웹 푸시 알림: 이미 허용된 경우에만 토큰을 조용히 받는다. 권한 요청은 설정의 「복습 알림」에서만 한다 (Common GUI push)
  initNotificationToken();
  initSettingNewDot();
  initNotificationInbox({ onStartStudy: startStudyFromInbox });

  // 새 판 감지: 설치한 앱은 스스로 다시 불러오지 않으므로 서버의 판을 확인해 안내한다 (Common GUI update-notice)
  startUpdateChecker();

  await loadCharacterDataset();
  updateHeaderControlBadges();
  resetToMainModeSelection();
  updateVisualBadges(userConfig);

  initAuthObserver(async (user) => {
    resetUserConfig();
    updateHeaderAuthUI(user);
    renderLoginModalState(user);

    if (user) {
      recordLoginSuccess(getActiveAuthProvider(user));
      await initUser(user.uid);
      await offerGuestProgressMerge();
    } else {
      await initUser(null);
    }

    applySavedConfig(await getUserConfig());
    applyAccentColor(userConfig.accentColor);
    comboState = await loadComboState();
    updateHeaderControlBadges();
    if (document.getElementById('mode-selection-layer')) {
      resetToMainModeSelection();
    }
    updateVisualBadges(userConfig);
    updateReviewCountBadge();
  });
}

function applySavedConfig(savedConfig) {
  if (!savedConfig) return;
  savedConfig.keybindings = savedConfig.keybindings
    ? Object.assign({}, userConfig.keybindings, savedConfig.keybindings)
    : JSON.parse(JSON.stringify(userConfig.keybindings));
  Object.assign(userConfig, savedConfig);
  if (!DOMAINS.includes(userConfig.currentDomain)) userConfig.currentDomain = 'sanrio';
  if (!QUIZ_DIRECTIONS.includes(userConfig.quizDirection)) userConfig.quizDirection = 'mixed';
  if (!NAME_LANGS.includes(userConfig.nameLang)) userConfig.nameLang = 'ko';
  if (!TEENIEPING_SEASONS.some((s) => s.id === userConfig.teeniepingSeason)) {
    userConfig.teeniepingSeason = 'all';
  }
  if (!TRIVIA_COUNT_OPTIONS.includes(Number(userConfig.triviaQuestionCount))) {
    userConfig.triviaQuestionCount = 10;
  } else {
    userConfig.triviaQuestionCount = Number(userConfig.triviaQuestionCount);
  }
  if (typeof userConfig.triviaShowName !== 'boolean') {
    userConfig.triviaShowName = true;
  }
}

/**
 * 로그인하면 이 기기에서 게스트로 학습한 캐릭터 기록을 계정에 바로 합친다(묻지 않음).
 * 새 계정이든 이미 있는 계정이든 같고, 캐릭터마다 더 최근에 학습한 쪽을 남긴다.
 */
async function offerGuestProgressMerge() {
  const candidate = findGuestProgressToMerge();
  await mergeGuestCombo();
  if (!candidate || candidate.items.length === 0) return;

  markGuestMergeHandled(candidate.flagKey);
  await mergeGuestProgress(candidate.items);
  showGuestMergedNotice(candidate.items.length);
}

/** 게스트 기록을 합친 뒤 한 번 알려 준다 */
function showGuestMergedNotice(count) {
  const overlay = document.createElement('div');
  overlay.className = 'inbox-overlay guest-rank-overlay';
  overlay.innerHTML = `
    <div class="inbox-card" role="dialog" aria-label="게스트 기록 합치기">
      <div class="inbox-header">
        <h4>✅ 게스트 기록을 합쳤어요</h4>
        <button type="button" class="inbox-close" aria-label="닫기">&times;</button>
      </div>
      <div class="guest-rank-body">
        <p>이 기기에서 게스트로 학습한 <b>${count}개 캐릭터</b>의 진도를 로그인한 계정에 합쳤습니다. 계정에 더 최근 기록이 있는 캐릭터는 계정 기록을 그대로 두었습니다.</p>
      </div>
    </div>`;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('.inbox-close')) overlay.remove();
  });
  document.body.appendChild(overlay);
}

function updateHeaderAuthUI(user) {
  const userNameDisplay = document.getElementById('profile-name');
  const iconEl = document.getElementById('header-auth-icon');
  const chipEl = document.getElementById('header-provider-chip');

  if (user) {
    const pureName = (user.displayName || '사용자').split(' ')[0].split('(')[0].trim();
    if (userNameDisplay) userNameDisplay.innerText = pureName;

    const provider = getActiveAuthProvider(user);
    const meta = PROVIDER_META[provider] || PROVIDER_META.google;
    if (iconEl) iconEl.classList.add('hidden');
    if (chipEl) {
      chipEl.className = `header-provider-chip ${meta.className}`;
      chipEl.innerText = meta.short;
      chipEl.title = `${meta.label}으로 로그인됨`;
    }
  } else {
    if (userNameDisplay) userNameDisplay.innerText = '게스트';
    if (iconEl) iconEl.classList.remove('hidden');
    if (chipEl) {
      chipEl.className = 'header-provider-chip hidden';
      chipEl.innerText = '';
    }
  }
}

function renderLoginModalState(user = auth.currentUser) {
  const modalRoot = document.getElementById('auth-modal-root');
  if (!modalRoot) return;

  const guestView = document.getElementById('auth-guest-view');
  const userView = document.getElementById('auth-user-view');
  const modalTitleEl = modalRoot.closest('.modal-content')?.querySelector('.modal-title');

  if (!user) {
    if (modalTitleEl) modalTitleEl.innerText = '간편 로그인';
    guestView?.classList.remove('hidden');
    userView?.classList.add('hidden');

    const history = getLoginSuccessHistory();
    const hasAnyHistory = history.length > 0;
    modalRoot.querySelectorAll('.social-login-btn[data-provider]').forEach((btn) => {
      const provider = btn.dataset.provider;
      const hasSucceededBefore = history.includes(provider);
      btn.classList.toggle('social-unvisited', hasAnyHistory && !hasSucceededBefore);

      let usedBadge = btn.querySelector('.social-used-badge');
      if (hasAnyHistory && hasSucceededBefore) {
        if (!usedBadge) {
          usedBadge = document.createElement('span');
          usedBadge.className = 'social-used-badge';
          usedBadge.innerText = '사용 이력';
          btn.appendChild(usedBadge);
        }
      } else if (usedBadge) {
        usedBadge.remove();
      }
    });
    return;
  }

  if (modalTitleEl) modalTitleEl.innerText = '로그인 계정';
  guestView?.classList.add('hidden');
  userView?.classList.remove('hidden');

  const provider = getActiveAuthProvider(user);
  const meta = PROVIDER_META[provider] || PROVIDER_META.google;

  const badgeEl = document.getElementById('auth-provider-badge');
  if (badgeEl) {
    badgeEl.className = `auth-provider-badge ${meta.className}`;
    badgeEl.innerText = meta.label;
  }

  const nameEl = document.getElementById('auth-user-name');
  if (nameEl) nameEl.innerText = (user.displayName || '사용자').split('(')[0].trim();

  const emailEl = document.getElementById('auth-user-email');
  if (emailEl) emailEl.innerText = formatUserEmailForDisplay(user) || `${meta.label} 연동됨`;

  const avatarBox = document.getElementById('auth-avatar-box');
  if (avatarBox) {
    avatarBox.innerHTML = '';
    if (user.photoURL) {
      const img = document.createElement('img');
      img.src = user.photoURL;
      img.alt = '프로필 이미지';
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => {
        avatarBox.innerHTML = '<span class="material-symbols-outlined">person</span>';
      };
      avatarBox.appendChild(img);
    } else {
      avatarBox.innerHTML = '<span class="material-symbols-outlined">person</span>';
    }
  }
}

function updateHeaderControlBadges() {
  const domMeta = DOMAIN_META[userConfig.currentDomain] || DOMAIN_META.sanrio;
  const dirMeta = QUIZ_DIRECTION_META[userConfig.quizDirection] || QUIZ_DIRECTION_META.mixed;

  const domBadge = document.getElementById('header-domain-badge');
  const domTrigger = document.getElementById('header-domain-trigger');
  if (domBadge) {
    domBadge.innerText = domMeta.badge;
    domBadge.className = `domain-btn ${userConfig.currentDomain === 'teenieping' ? 'teenieping' : ''}`;
  }
  if (domTrigger) {
    domTrigger.title = `현재 도메인: ${domMeta.title} (클릭하여 산리오↔티니핑 전환)`;
  }

  const dirBadge = document.getElementById('header-direction-badge');
  const dirTrigger = document.getElementById('header-direction-trigger');
  if (dirBadge) dirBadge.innerText = dirMeta.badge;
  if (dirTrigger) dirTrigger.title = `출제 방식: ${dirMeta.label} (그림→이름→교차→질문)`;
}

function stopAllSessionTimers() {
  stopInfoCardFloatingChars();
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (spectatorIntervalId) {
    clearInterval(spectatorIntervalId);
    spectatorIntervalId = null;
  }
}

window.startSessionWorkflow = async function (mode) {
  if (isStartingSession) return;
  isStartingSession = true;
  stopAllSessionTimers();
  srTimeAttack = mode === 'timeattack';
  if (srTimeAttack) mode = 'record';
  currentMode = mode;
  isTriviaSetSession = !srTimeAttack && (mode !== 'spectator' && userConfig.quizDirection === 'trivia');

  try {
    const versionQuery = (window.CACHE_BUST || window.APP_VERSION) ? `?v=${window.CACHE_BUST || window.APP_VERSION}` : '';
    const viewFile = mode === 'spectator' ? 'spectatorMode' : 'studyMode';
    const response = await fetch(`./view/${viewFile}.html${versionQuery}`);
    if (!response.ok) throw new Error(`${viewFile}.html 로드 실패`);

    const htmlContent = await response.text();
    const mainBox = document.getElementById('main-box');
    if (mainBox) mainBox.innerHTML = htmlContent;

    document.querySelector('.user-info-right')?.classList.add('hidden');
    const headerQuizControl = document.getElementById('header-quiz-control');
    if (headerQuizControl) headerQuizControl.style.display = 'flex';

    const title = document.getElementById('current-mode-title');
    const badge = document.getElementById('header-mode-badge');
    const badgeIcon = badge?.querySelector('.mode-badge-icon');
    const pauseBtn = document.getElementById('header-pause-btn');
    const stopBtn = document.getElementById('header-stop-btn');

    if (pauseBtn) {
      pauseBtn.style.display = 'flex';
      pauseBtn.setAttribute('aria-label', '일시정지');
      pauseBtn.setAttribute('title', '일시정지');
      pauseBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 1.3rem;">pause</span>';
      pauseBtn.style.background = '';
      pauseBtn.style.borderColor = '';
    }
    if (stopBtn) {
      stopBtn.style.display = 'flex';
      const stopTitle = mode === 'spectator' ? '관전 종료' : '중단';
      stopBtn.setAttribute('aria-label', stopTitle);
      stopBtn.setAttribute('title', stopTitle);
    }

    const domLabel = DOMAIN_META[userConfig.currentDomain]?.badge || '';
    if (title && badge) {
      if (isTriviaSetSession) {
        title.innerText = mode === 'record' ? `${domLabel} 질문 기록` : `${domLabel} 질문 퀴즈`;
        badge.className = mode === 'record' ? 'mode-badge record' : 'mode-badge study';
        if (badgeIcon) badgeIcon.innerText = 'quiz';
      } else if (mode === 'study') {
        title.innerText = `${domLabel} 학습`;
        badge.className = 'mode-badge study';
        if (badgeIcon) badgeIcon.innerText = 'school';
      } else if (mode === 'record') {
        title.innerText = srTimeAttack ? `${domLabel} 30초 타임어택` : `${domLabel} 20문제`;
        badge.className = 'mode-badge record';
        if (badgeIcon) badgeIcon.innerText = 'timer';
      } else {
        title.innerText = `${domLabel} 관전`;
        badge.className = 'mode-badge spectator';
        if (badgeIcon) badgeIcon.innerText = 'visibility';
      }
    }

    if (isTriviaSetSession) {
      await startTriviaSetSession();
    } else if (mode === 'study') {
      await startQuizSession();
    } else if (mode === 'record') {
      await startSpeedrunSession();
    } else {
      await startSpectatorSession();
    }
  } catch (error) {
    console.error('세션 진입 중 오류 발생:', error);
  } finally {
    isStartingSession = false;
  }
};

function renderQuestionPromptAndOptions(optionsContainer, onAnswerCallback) {
  const promptCard = document.getElementById('question-prompt-card');
  const typeChip = document.getElementById('question-type-chip');
  const promptBody = document.getElementById('question-prompt-body');

  const domain = userConfig.currentDomain;
  const { target, options, questionType, categoryChip, promptText } = currentQuestion;
  const targetMeta = getCharacterById(target.charId, domain) || target;

  if (promptCard && promptBody && typeChip) {
    typeChip.hidden = false;
    if (questionType === 'trivia') {
      promptCard.className = 'question-prompt-card prompt-trivia-mode';
      typeChip.innerText = categoryChip || '❓ 프로필 질문 퀴즈';
      promptBody.innerHTML = `<p class="prompt-trivia-text">${escapeHtml(promptText)}</p>`;
    } else if (questionType === 'img2name') {
      promptCard.className = 'question-prompt-card prompt-image-mode';
      typeChip.innerText = '🖼️ 이 캐릭터의 이름은?';
      promptBody.innerHTML = `<img src="${targetMeta.imageUrl}" alt="출제 캐릭터" class="prompt-char-img" />`;
    } else {
      promptCard.className = 'question-prompt-card prompt-name-mode';
      // 이름→캐릭터 모드: 안내 문구가 문제(이름)를 가려서 칩을 숨긴다.
      typeChip.innerText = '';
      typeChip.hidden = true;
      promptBody.innerHTML = `<div class="prompt-char-name">${getCharacterNameHtml(targetMeta, userConfig.nameLang)}</div>`;
    }
  }
  if (promptCard) renderPromptHintButton(promptCard, domain, targetMeta, questionType);

  options.forEach((charId, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.charId = String(charId);

    const optMeta = getCharacterById(charId, domain) || currentPool.find((p) => p.charId === charId);
    if (questionType === 'img2name') {
      btn.className = 'option-btn option-text-mode';
      btn.innerHTML = `<span class="keybind-hint">${OPTION_KEYBIND_HINTS[idx]}</span>${getCharacterNameHtml(optMeta, userConfig.nameLang)}`;
    } else if (questionType === 'trivia' && userConfig.triviaShowName !== false) {
      btn.className = 'option-btn option-trivia-mode';
      const caption = getCharacterPlainName(optMeta, userConfig.nameLang);
      btn.innerHTML = `
        <span class="keybind-hint">${OPTION_KEYBIND_HINTS[idx]}</span>
        <img src="${optMeta?.imageUrl || ''}" alt="선택지 ${idx + 1}" class="option-trivia-img" />
        <span class="option-trivia-caption">${escapeHtml(caption)}</span>
      `;
    } else {
      btn.className = 'option-btn option-image-mode';
      btn.innerHTML = `<span class="keybind-hint">${OPTION_KEYBIND_HINTS[idx]}</span><img src="${optMeta?.imageUrl || ''}" alt="선택지 ${idx + 1}" class="option-char-img" />`;
    }

    btn.onclick = () => {
      const latency = Date.now() - questionStartTime;
      if (latency < MIN_CLICK_LATENCY_MS) return;
      onAnswerCallback(charId, latency, btn);
    };
    optionsContainer.appendChild(btn);
  });
}

/**
 * 학습 모드 문제 카드의 💡 단추. 누르면 그 캐릭터의 힌트 목록 창을 연다(내 힌트 쓰기 포함).
 * 창이 열려 있는 동안은 풀이 시간을 멈추고, 닫으면 다시 흐르게 한다.
 * 기록 모드, 관전, 질문 퀴즈에는 달지 않는다.
 */
function renderPromptHintButton(promptCard, domain, targetMeta, questionType) {
  promptCard.querySelector('.prompt-hint-area')?.remove();
  if (currentMode !== 'study' || isTriviaSetSession || questionType === 'trivia' || !targetMeta?.koName) return;

  const area = document.createElement('div');
  area.className = 'prompt-hint-area';
  area.innerHTML = `
    <button type="button" class="prompt-hint-btn" title="힌트 보기·쓰기" aria-label="힌트 보기·쓰기">
      <span class="material-symbols-outlined">lightbulb</span>
    </button>
  `;
  area.querySelector('.prompt-hint-btn').addEventListener('click', () => {
    const pausedByHint = !isPaused && !isTimeUp;
    if (pausedByHint) window.pauseGameTrigger();
    openHintListModal(domain, targetMeta.koName, {
      onClose: () => {
        if (pausedByHint && isPaused) window.pauseGameTrigger();
      }
    });
  });
  promptCard.appendChild(area);
}

function startStudyFromInbox() {
  if (timerInterval && !isTimeUp) return;
  window.startSessionWorkflow?.('study');
}

async function handleAnswerFeedback(isCorrect, clickedBtn, targetCharId) {
  if (isCorrect) {
    if (clickedBtn) clickedBtn.classList.add('correct-anim');
    await new Promise((resolve) => setTimeout(resolve, 140));
    return;
  }

  if (clickedBtn) clickedBtn.classList.add('incorrect-anim');
  if (userConfig.errorFeedbackMode !== 'none') {
    const correctBtn = document.querySelector(`.option-btn[data-char-id="${targetCharId}"]`);
    if (correctBtn) correctBtn.classList.add('correct-anim');
    await new Promise((resolve) => setTimeout(resolve, 900));
  } else {
    await new Promise((resolve) => setTimeout(resolve, 260));
  }
}

/* ==========================================================================
   질문(Trivia) 세트 모드 (기본 10문항 풀이 후 점수·정답률·해설 리포트 제공)
   ========================================================================== */
async function startTriviaSetSession() {
  isTimeUp = false;
  isPaused = false;
  sessionHistory = [];
  triviaSetLogs = [];
  usedTriviaSignatures = new Set();

  const historyBar = document.getElementById('history-bar');
  if (historyBar) historyBar.innerHTML = '';

  const domain = userConfig.currentDomain;
  // 질문 모드의 정오답은 도감/학습 현황(숙련도·해금·반응속도·학습시간)과 무관하게 독립 운영
  currentPool = getCharacters(domain, 'all');

  srTotalCount = Math.max(5, Number(userConfig.triviaQuestionCount) || 10);
  srCurrentIndex = 0;
  srCorrectCount = 0;
  srElapsedTime = 0;

  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(tickTriviaTimer, 1000);

  await renderNextTriviaQuestion();
}

function tickTriviaTimer() {
  srElapsedTime++;
  const weightDisplay = document.getElementById('weight-display');
  if (weightDisplay && isTriviaSetSession) {
    const idxDisplay = Math.min(srCurrentIndex + 1, srTotalCount);
    weightDisplay.innerText = `질문 ${idxDisplay} / ${srTotalCount} | 정답: ${srCorrectCount}개 | ⏱️ ${formatTime(srElapsedTime)}`;
  }
}

async function renderNextTriviaQuestion() {
  const optionsContainer = document.getElementById('options');
  if (!optionsContainer) return;
  optionsContainer.innerHTML = '';
  optionsContainer.style.pointerEvents = 'auto';
  optionsContainer.style.opacity = '1';

  if (srCurrentIndex >= srTotalCount) {
    await terminateTriviaSetSession(true);
    return;
  }

  const domain = userConfig.currentDomain;
  const seasonFilter = getActiveSeasonFilter();
  currentQuestion = generateTriviaQuestion(domain, seasonFilter, usedTriviaSignatures);

  // 이번 문항 4개 후보 캐릭터 이미지 즉시 프리로드
  const optionMetas = currentQuestion.options
    .map((id) => getCharacterById(id, domain))
    .filter(Boolean);
  await preloadCharacterImages(optionMetas);

  const weightDisplay = document.getElementById('weight-display');
  if (weightDisplay) {
    weightDisplay.style.color = '#334155';
    weightDisplay.innerText = `질문 ${srCurrentIndex + 1} / ${srTotalCount} | 정답: ${srCorrectCount}개 | ⏱️ ${formatTime(srElapsedTime)}`;
  }

  updateTimerProgressBar(srTotalCount - (srCurrentIndex + 1), srTotalCount);
  renderQuestionPromptAndOptions(optionsContainer, handleTriviaAnswer);
  questionStartTime = Date.now();
}

async function handleTriviaAnswer(selectedCharId, latency, clickedBtn) {
  const optionsContainer = document.getElementById('options');
  if (optionsContainer) optionsContainer.style.pointerEvents = 'none';

  const domain = userConfig.currentDomain;
  const target = currentQuestion.target;
  const isCorrect = Number(selectedCharId) === Number(target.charId);
  if (isCorrect) srCorrectCount++;

  triviaSetLogs.push({
    promptText: currentQuestion.promptText,
    explanation: currentQuestion.explanation,
    targetMeta: getCharacterById(target.charId, domain) || target,
    selectedMeta: getCharacterById(selectedCharId, domain),
    isCorrect
  });

  sessionHistory.push({ domain, charId: target.charId, isCorrect, speed: latency });
  updateHistoryBarUI();

  await handleAnswerFeedback(isCorrect, clickedBtn, target.charId);

  srCurrentIndex++;
  await renderNextTriviaQuestion();
}

async function terminateTriviaSetSession(isCompletedAll = false) {
  const savedMode = currentMode;
  const reportSnapshot = {
    totalCount: srTotalCount,
    correctCount: srCorrectCount,
    elapsedSeconds: srElapsedTime,
    logs: [...triviaSetLogs]
  };

  stopAllSessionTimers();
  isPaused = false;
  isTimeUp = false;
  isTriviaSetSession = false;

  resetToMainModeSelection();

  // 질문 모드는 도감 진도·학습 현황 통계(해금/숙련도/일일 학습시간)에 영향을 주지 않고,
  // 두 타임어택(20문제·30초)이 아니므로 순위에도 올리지 않는다
  if (isCompletedAll && reportSnapshot.logs.length > 0) {
    openTriviaReportModal({
      ...reportSnapshot,
      onRetry: () => window.startSessionWorkflow(savedMode)
    });
  }
  if (isCompletedAll && savedMode === 'record' && !canSubmitRanking()) showGuestRankingNotice();
}

/* ==========================================================================
   일반 학습 모드 (시간제 간격 반복 루프: 그림 / 이름 / 교차)
   ========================================================================== */
async function startQuizSession() {
  isTimeUp = false;
  isPaused = false;
  sessionHistory = [];
  lastTargetCharId = null;

  const historyBar = document.getElementById('history-bar');
  if (historyBar) historyBar.innerHTML = '';

  const domain = userConfig.currentDomain;
  const seasonFilter = getActiveSeasonFilter();
  const dbData = await getAllProgress(domain);
  // 자동 진도: 최근 학습 정답률을 목표 정답률과 견줘 새 캐릭터 수를 정한다 (components/adaptive-progress.js)
  const progressPlan = planNewItems(userConfig.autoProgress, userConfig.targetAccuracy);
  currentPool = initSessionPool(domain, dbData, progressPlan, userConfig.MAX_POOL_SIZE, seasonFilter);

  // 복습은 항상 포함: 시즌을 골라 두었어도 다른 시즌의 복습 때가 된 캐릭터를 함께 낸다(새 캐릭터는 고른 시즌에서만).
  // 풀이 넘치면 복습 캐릭터를 먼저 남긴다. (QuizApp Common GUI 「복습은 항상 포함」)
  if (seasonFilter !== 'all') {
    const dueElsewhere = initSessionPool(domain, dbData, false, 9999, 'all')
      .filter((item) => item.isEligibleForPromotion && !currentPool.some((p) => p.charId === item.charId));
    if (dueElsewhere.length) {
      const poolLimit = Math.max(4, Number(userConfig.MAX_POOL_SIZE) || 10);
      currentPool = [...currentPool, ...dueElsewhere]
        .sort(() => Math.random() - 0.5)
        .sort((a, b) => Number(Boolean(b.isEligibleForPromotion || b.isForcedNew)) - Number(Boolean(a.isEligibleForPromotion || a.isForcedNew)))
        .slice(0, Math.max(poolLimit, currentPool.length));
    }
  }

  if (!currentPool || currentPool.length === 0) {
    alert('출제 가능한 캐릭터 데이터가 없습니다.');
    resetToMainModeSelection();
    return;
  }

  sessionStartSnapshot = {};
  currentPool.forEach((item) => {
    sessionStartSnapshot[item.charId] = {
      stage: item.stage || 0,
      hadHistory: (item.totalSolved || 0) > 0,
      avgBefore: averageLatencySec(item)
    };
  });

  await preloadCharacterImages(currentPool);

  timeLeft = userConfig.learningTime;
  updateTimerProgressBar(timeLeft, userConfig.learningTime);
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(tickSessionTimer, 1000);

  await renderNextQuestion();
}

async function renderNextQuestion() {
  const optionsContainer = document.getElementById('options');
  if (!optionsContainer) return;
  optionsContainer.innerHTML = '';
  optionsContainer.style.pointerEvents = 'auto';
  optionsContainer.style.opacity = '1';

  const domain = userConfig.currentDomain;
  const seasonFilter = getActiveSeasonFilter();
  const targetItem = pickNextTarget(currentPool, lastTargetCharId);
  lastTargetCharId = targetItem.charId;
  currentQuestion = generateFourOptions(targetItem, currentPool, userConfig.quizDirection, domain, seasonFilter);

  updatePoolIndicatorUI();
  renderQuestionPromptAndOptions(optionsContainer, handleUserAnswer);
  questionStartTime = Date.now();
}

async function handleUserAnswer(selectedCharId, latency, clickedBtn) {
  const optionsContainer = document.getElementById('options');
  if (optionsContainer) optionsContainer.style.pointerEvents = 'none';

  const target = currentQuestion.target;
  const isCorrect = Number(selectedCharId) === Number(target.charId);
  recordStudyAnswer(isCorrect, latency); // 목표 정답률에 맞춘 자동 진도용 (늦은 정답은 오답)

  const updatedItem = calculateReviewState({ ...target }, isCorrect, latency);
  const poolIdx = currentPool.findIndex((p) => p.charId === target.charId);
  if (poolIdx !== -1) currentPool[poolIdx] = updatedItem;
  updatePoolIndicatorUI();

  sessionHistory.push({
    domain: userConfig.currentDomain,
    charId: target.charId,
    isCorrect,
    speed: latency
  });
  updateHistoryBarUI();
  if (isCorrect) showCombo(getTrailingStreak(sessionHistory));
  trackRunningCombo(isCorrect);

  await handleAnswerFeedback(isCorrect, clickedBtn, target.charId);

  if (isTimeUp) {
    await terminateQuizSession();
  } else {
    await renderNextQuestion();
  }
}

function tickSessionTimer() {
  timeLeft--;
  if (timeLeft <= 0) {
    clearInterval(timerInterval);
    timerInterval = null;
    isTimeUp = true;
    updateTimerProgressBar(0, userConfig.learningTime);

    const weightDisplay = document.getElementById('weight-display');
    if (weightDisplay) {
      weightDisplay.innerText = '⏰ 시간 종료! 현재 문제까지 풀이하면 정산됩니다.';
      weightDisplay.style.color = '#e11d48';
    }
  } else {
    updateTimerProgressBar(timeLeft, userConfig.learningTime);
  }
}

function updateTimerProgressBar(left, total) {
  const timerBar = document.getElementById('timer-progress-bar');
  if (timerBar && total > 0) {
    const percentage = Math.min(100, Math.max(0, ((total - left) / total) * 100));
    timerBar.style.width = `${percentage}%`;
  }
}

function resolveRankingMetadata() {
  const rankingDomain = buildRankingDomainKey(
    userConfig.currentDomain,
    getActiveSeasonFilter(),
    userConfig.quizDirection
  );
  let playerName = document.getElementById('profile-name')?.innerText ||
    (auth.currentUser ? (auth.currentUser.displayName || '이름 없음') : '게스트');
  if (playerName.includes('(')) playerName = playerName.split('(')[0].trim();

  return { rankingDomain, playerName };
}

/* ---------- 순위는 로그인한 사용자만 (게스트도 학습·기록 모드는 그대로) ---------- */

function canSubmitRanking() {
  return Boolean(auth.currentUser);
}

/** 게스트가 순위에 남을 기록을 냈을 때: 「로그인하면 순위에 올라가요」와 로그인 단추 */
function showGuestRankingNotice() {
  document.querySelector('.guest-rank-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'inbox-overlay guest-rank-overlay';
  overlay.innerHTML = `
    <div class="inbox-card" role="dialog" aria-label="순위 안내">
      <div class="inbox-header">
        <h4>🔐 로그인하고 기록 지키기</h4>
        <button type="button" class="inbox-close" aria-label="닫기">&times;</button>
      </div>
      <div class="guest-rank-body">
        <p>로그인하면 지금까지 게스트로 학습한 기록이 계정에 합쳐져 다른 기기에서도 이어서 할 수 있고, 다음 기록부터 리더보드에도 올라갑니다.</p>
        <button type="button" class="guest-rank-login">로그인</button>
      </div>
    </div>`;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('.inbox-close')) overlay.remove();
    else if (e.target.closest('.guest-rank-login')) {
      overlay.remove();
      window.popupLogin();
    }
  });
  document.body.appendChild(overlay);
}

async function terminateQuizSession() {
  stopAllSessionTimers();
  isTimeUp = false;
  isPaused = false;

  const domain = userConfig.currentDomain;
  resetToMainModeSelection();
  saveComboStats(getSessionMaxCombo(sessionHistory), comboState);
  showStudySummary();

  // 복습 알림 예약은 Firestore 저장과 따로 먼저 시작한다.
  // 연결이 나쁘면 Firestore 저장이 끝나지 않고 멈춰 있어, 그 뒤에 두면 예약 요청이 아예 나가지 않는다.
  if (userConfig.reviewReminder !== false && currentPool.length > 0) {
    const nextTargetStage = Math.min(...currentPool.map((p) => p.stage || 0));
    const reminderDelayMin = INTERVALS[nextTargetStage] || 10;
    scheduleReviewNotification(domain, reminderDelayMin);
  }

  try {
    await saveSessionPoolState(domain, currentPool);
    const playedTime = Math.max(0, userConfig.learningTime - Math.max(0, timeLeft));
    await updateDailyStudyTime(playedTime, domain);
    updateReviewCountBadge();

    const correctCount = sessionHistory.filter((h) => h.isCorrect).length;
    const accuracy = sessionHistory.length > 0 ? Math.round((correctCount / sessionHistory.length) * 100) : 0;
    const { rankingDomain, playerName } = resolveRankingMetadata();
    // 학습 시간을 30초로 두고 끝까지 했으면 30초 타임어택 기록으로 본다(본인 최고 기록보다 좋을 때만 바뀜)
    if (canSubmitRanking() && userConfig.learningTime === TIME_ATTACK_SECONDS && timeLeft <= 0) {
      await submitTimeAttackRanking(rankingDomain, correctCount, sessionHistory.length, accuracy, playerName);
    }
    // 게스트의 로그인 안내는 학습 결과표 아래에 함께 나온다(showStudySummary)
  } catch (dbError) {
    console.warn('[LocalFirst] 학습 세션 정산 안내:', dbError.message || dbError);
  }
}

/* ==========================================================================
   기록 모드 (타임어택 스피드런: 그림 / 이름 / 교차)
   ========================================================================== */
async function startSpeedrunSession() {
  isTimeUp = false;
  isPaused = false;
  sessionHistory = [];

  const historyBar = document.getElementById('history-bar');
  if (historyBar) historyBar.innerHTML = '';

  const domain = userConfig.currentDomain;
  const seasonFilter = getActiveSeasonFilter();
  const dbData = await getAllProgress(domain);
  const now = Date.now();
  const fullPool = buildMergedCharacterList(domain, dbData, seasonFilter);

  currentPool = fullPool.map((item) => {
    const rawSaved = dbData[String(item.charId)] || dbData[item.charId];
    if (!rawSaved) return { ...item, isUnlocked: false };

    const saved = toPersistedSchema(rawSaved);
    return {
      ...item,
      ...saved,
      stage: saved.stage || 0,
      recentLatencies: saved.recentLatencies || [],
      latenciesIdx: saved.latenciesIdx || 0,
      outCnt: saved.outCnt || 0,
      resetOutCnt: saved.resetOutCnt || 0,
      totalSolved: saved.totalSolved || 0,
      hasHistory: (saved.totalSolved || 0) > 0,
      isEligibleForPromotion: isDueForReview(saved, now),
      hasBeenPromotedThisSession: false,
      // 이미 공부한(한 번이라도 푼) 문제는 단계가 0이어도 기록 모드 결과를 학습 데이터에 쌓는다
      isUnlocked: (saved.totalSolved || 0) > 0 || (saved.stage || 0) > 0
    };
  });

  currentPool.sort(() => Math.random() - 0.5);

  srTotalCount = srTimeAttack ? currentPool.length : Math.min(currentPool.length, SPEEDRUN_MAX_QUESTIONS);
  srCurrentIndex = 0;
  srCorrectCount = 0;
  srElapsedTime = 0;
  taTimeLeft = TIME_ATTACK_SECONDS;

  await preloadCharacterImages(currentPool.slice(0, srTimeAttack ? 24 : srTotalCount));

  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(tickSpeedrunTimer, 1000);

  await renderNextSpeedrunQuestion();
}

async function renderNextSpeedrunQuestion() {
  const optionsContainer = document.getElementById('options');
  if (!optionsContainer) return;
  optionsContainer.innerHTML = '';
  optionsContainer.style.pointerEvents = 'auto';
  optionsContainer.style.opacity = '1';

  if (!srTimeAttack && srCurrentIndex >= srTotalCount) {
    await terminateSpeedrunSession();
    return;
  }
  if (srTimeAttack && taTimeLeft <= 0) return;

  if (srCurrentIndex % 16 === 0 && srCurrentIndex + 16 < srTotalCount) {
    preloadCharacterImages(currentPool.slice(srCurrentIndex + 16, Math.min(srCurrentIndex + 40, srTotalCount)));
  }

  const domain = userConfig.currentDomain;
  const seasonFilter = getActiveSeasonFilter();
  const targetItem = currentPool[srCurrentIndex % currentPool.length];
  const direction = srTimeAttack && userConfig.quizDirection === 'trivia' ? 'mixed' : userConfig.quizDirection;
  currentQuestion = generateFourOptions(targetItem, currentPool, direction, domain, seasonFilter);

  const weightDisplay = document.getElementById('weight-display');
  if (weightDisplay) {
    weightDisplay.style.color = '#334155';
    weightDisplay.innerText = srTimeAttack
      ? `⏱️ ${Math.max(0, taTimeLeft)}초 | ✅ ${srCorrectCount} / ${srCurrentIndex}`
      : `진행률: ${srCurrentIndex + 1} / ${srTotalCount} | 정답: ${srCorrectCount} | ⏱️ ${formatTime(srElapsedTime)}`;
  }

  if (srTimeAttack) updateTimerProgressBar(taTimeLeft, TIME_ATTACK_SECONDS);
  else updateTimerProgressBar(srTotalCount - (srCurrentIndex + 1), srTotalCount);
  renderQuestionPromptAndOptions(optionsContainer, handleSpeedrunAnswer);
  questionStartTime = Date.now();
}

async function handleSpeedrunAnswer(selectedCharId, latency, clickedBtn) {
  const optionsContainer = document.getElementById('options');
  if (optionsContainer) optionsContainer.style.pointerEvents = 'none';

  if (srTimeAttack && taTimeLeft <= 0) return;
  const target = currentQuestion.target;
  const isCorrect = Number(selectedCharId) === Number(target.charId);
  if (isCorrect) srCorrectCount++;

  if (target.isUnlocked) {
    const poolIdx = srCurrentIndex % currentPool.length;
    const updatedItem = calculateReviewState({ ...currentPool[poolIdx] }, isCorrect, latency);
    currentPool[poolIdx] = { ...updatedItem, isUnlocked: true, touched: true };
  }

  sessionHistory.push({ domain: userConfig.currentDomain, charId: target.charId, isCorrect, speed: latency });
  updateHistoryBarUI();

  await handleAnswerFeedback(isCorrect, clickedBtn, target.charId);

  srCurrentIndex++;
  await renderNextSpeedrunQuestion();
}

function tickSpeedrunTimer() {
  srElapsedTime++;
  if (srTimeAttack) {
    taTimeLeft--;
    const display = document.getElementById('weight-display');
    if (display) display.innerText = `⏱️ ${Math.max(0, taTimeLeft)}초 | ✅ ${srCorrectCount} / ${srCurrentIndex}`;
    updateTimerProgressBar(Math.max(0, taTimeLeft), TIME_ATTACK_SECONDS);
    if (taTimeLeft <= 0) terminateSpeedrunSession();
    return;
  }
  const weightDisplay = document.getElementById('weight-display');
  if (weightDisplay && currentMode === 'record' && !isTriviaSetSession) {
    const idxDisplay = Math.min(srCurrentIndex + 1, srTotalCount);
    weightDisplay.innerText = `진행률: ${idxDisplay} / ${srTotalCount} | 정답: ${srCorrectCount} | ⏱️ ${formatTime(srElapsedTime)}`;
  }
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

async function terminateSpeedrunSession() {
  if (srTimeAttack) {
    await terminateTimeAttackSession();
    return;
  }
  const isCompletedAll = srCurrentIndex >= srTotalCount && srTotalCount > 0;
  const domain = userConfig.currentDomain;
  stopAllSessionTimers();
  isPaused = false;
  isTimeUp = false;

  resetToMainModeSelection();

  try {
    const itemsToSave = currentPool.filter((item) => item.isUnlocked);
    if (itemsToSave.length > 0) {
      await saveSessionPoolState(domain, itemsToSave);
    }
    await updateDailyStudyTime(srElapsedTime, domain);
    updateReviewCountBadge();

    if (isCompletedAll) {
      const accuracy = Math.round((srCorrectCount / srTotalCount) * 100);
      const loggedIn = canSubmitRanking();
      if (loggedIn) {
        const { rankingDomain, playerName } = resolveRankingMetadata();
        const recordId = await submitSpeedrunRanking(rankingDomain, srTotalCount, srElapsedTime, accuracy, playerName);
        if (recordId) {
          window.highlightRecordId = recordId;
          window.highlightRemaining = 1;
        }
      }
      const timeStr = formatTime(srElapsedTime).replace(/^00:/, '');
      showTimeAttackResultOverlay({
        title: `${srTotalCount}문제 타임어택`,
        resultHtml: `<strong>${timeStr}</strong>`,
        note: `${srTotalCount}문제 · 맞힘 ${srCorrectCount}개 · 정답률 ${accuracy}%`,
        shareText: `NameQuiz ${srTotalCount}문제 타임어택 ${srElapsedTime >= 60 ? `${Math.floor(srElapsedTime / 60)}분 ` : ''}${srElapsedTime % 60}초 완주! 정답률 ${accuracy}% (${srCorrectCount}/${srTotalCount}) 나도 도전해 봐!`,
        onLeaderboard: loggedIn ? () => window.popupLeaderboard(getDefaultLeaderboardFilter(), 'speedrun') : null
      });
    }
  } catch (err) {
    console.error('기록 모드 정산 중 예외 발생:', err);
  }
}

/**
 * 타임어택(20문제·30초) 결과 창. 누구에게나 「결과 공유하기」(카톡·문자 등 공유 서랍)가 있고,
 * 게스트에게는 로그인 안내, 로그인한 사람에게는 「순위 보기」가 붙는다.
 */
function showTimeAttackResultOverlay({ title, resultHtml, note, shareText, onLeaderboard = null }) {
  const loginNote = canSubmitRanking() ? '' : `
      <div class="ranking-login-note">
        <span>로그인하면 지금까지 게스트로 학습한 기록이 계정에 합쳐지고, 다음 기록부터 리더보드에도 올라갑니다.</span>
        <button type="button" class="ranking-login-btn">로그인</button>
      </div>`;
  const leaderboardBtn = onLeaderboard ? '<button type="button" class="share-result-btn result-leaderboard-btn">🏆 순위 보기</button>' : '';
  const overlay = document.createElement('div');
  overlay.className = 'inbox-overlay info-overlay';
  overlay.innerHTML = `
    <div class="inbox-card" role="dialog" aria-label="${escapeHtml(title)} 결과">
      <div class="inbox-header">
        <h4>${escapeHtml(title)}</h4>
        <button type="button" class="inbox-close" aria-label="닫기">&times;</button>
      </div>
      <div class="info-overlay-body">
        <div class="timeattack-result">${resultHtml}</div>
        <p class="study-summary-note">${escapeHtml(note)}</p>
        <div class="share-result-row">
          <button type="button" class="share-result-btn result-share-btn">📤 결과 공유하기</button>
          ${leaderboardBtn}
        </div>
        ${loginNote}
      </div>
    </div>`;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('.inbox-close')) overlay.remove();
    else if (e.target.closest('.result-share-btn')) shareApp(shareText);
    else if (e.target.closest('.result-leaderboard-btn')) {
      overlay.remove();
      onLeaderboard();
    } else if (e.target.closest('.ranking-login-btn')) {
      overlay.remove();
      window.popupLogin();
    }
  });
  document.body.appendChild(overlay);
}

/** 30초 타임어택을 마친다. 시간이 다 됐으면 결과 창을 띄우고(게스트는 로그인 안내), 로그인했으면 30초 순위에 올린다 */
async function terminateTimeAttackSession() {
  const finishedInTime = taTimeLeft <= 0;
  const solved = srCurrentIndex;
  const correct = srCorrectCount;
  const domain = userConfig.currentDomain;
  srTimeAttack = false;
  stopAllSessionTimers();
  isPaused = false;
  isTimeUp = false;
  resetToMainModeSelection();

  const accuracy = solved > 0 ? Math.round((correct / solved) * 100) : 0;
  if (finishedInTime && solved > 0) {
    showTimeAttackResultOverlay({
      title: '30초 타임어택',
      resultHtml: `<strong>${correct}</strong><span>개 맞힘</span>`,
      note: `푼 문제 ${solved}개 · 정답률 ${accuracy}%`,
      shareText: `NameQuiz 30초 타임어택 ${correct}개 맞힘! 정답률 ${accuracy}% (${correct}/${solved}) 나도 도전해 봐!`
    });
  }

  try {
    const itemsToSave = currentPool.filter((item) => item.isUnlocked && item.touched);
    if (itemsToSave.length > 0) await saveSessionPoolState(domain, itemsToSave);
    await updateDailyStudyTime(TIME_ATTACK_SECONDS - Math.max(0, taTimeLeft), domain);
    updateReviewCountBadge();
    if (finishedInTime && solved > 0 && canSubmitRanking()) {
      const { rankingDomain, playerName } = resolveRankingMetadata();
      await submitTimeAttackRanking(rankingDomain, correct, solved, accuracy, playerName);
    }
  } catch (err) {
    console.error('30초 타임어택 정산 중 예외 발생:', err);
  }
}

/* ==========================================================================
   관전 모드 (캐릭터 일러스트 + 상세 프로필 자동 슬라이드)
   ========================================================================== */
async function startSpectatorSession() {
  lastSpectatorCharId = null;

  const domain = userConfig.currentDomain;
  const seasonFilter = getActiveSeasonFilter();
  const dbData = await getAllProgress(domain);
  const allCharacters = buildMergedCharacterList(domain, dbData, seasonFilter);
  const targetPoolSize = Math.min(allCharacters.length, Math.max(4, userConfig.MAX_POOL_SIZE || 10));

  const getAvg = (item) => {
    if (!item.recentLatencies || item.recentLatencies.length === 0) return 0;
    return item.recentLatencies.reduce((a, b) => a + b, 0) / item.recentLatencies.length;
  };

  const unlocked = allCharacters.filter((item) => item.hasHistory);
  unlocked.sort((a, b) => getAvg(b) - getAvg(a));

  currentPool = unlocked.slice(0, targetPoolSize);
  const minSpectatorCount = Math.min(allCharacters.length, Math.min(8, targetPoolSize));
  if (currentPool.length < minSpectatorCount) {
    const needed = minSpectatorCount - currentPool.length;
    const extras = allCharacters.filter((item) => !currentPool.some((p) => p.charId === item.charId));
    currentPool = currentPool.concat(extras.slice(0, needed));
  }

  await preloadCharacterImages(currentPool);
  updatePoolIndicatorUI();

  const cardTrigger = document.getElementById('spectator-card-trigger');
  if (cardTrigger) {
    cardTrigger.onclick = () => {
      if (!isPaused) tickSpectator();
    };
  }

  const intervalMs = (userConfig.spectatorInterval || 2) * 1000;
  tickSpectator();

  if (spectatorIntervalId) clearInterval(spectatorIntervalId);
  spectatorIntervalId = setInterval(tickSpectator, intervalMs);

  timeLeft = userConfig.learningTime;
  updateTimerProgressBar(timeLeft, userConfig.learningTime);
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(tickSpectatorSessionTimer, 1000);
}

function tickSpectatorSessionTimer() {
  timeLeft--;
  if (timeLeft <= 0) {
    terminateSpectatorSession();
  } else {
    updateTimerProgressBar(timeLeft, userConfig.learningTime);
  }
}

function tickSpectator() {
  if (currentPool.length === 0) return;

  const domain = userConfig.currentDomain;
  const candidates = currentPool.filter((item) => item.charId !== lastSpectatorCharId);
  const nextItem = candidates.length > 0
    ? candidates[Math.floor(Math.random() * candidates.length)]
    : currentPool[0];

  lastSpectatorCharId = nextItem.charId;
  const meta = getCharacterById(nextItem.charId, domain) || nextItem;
  const profileSpec = getCharacterProfileSpec(meta);

  const cardEl = document.getElementById('spectator-card');
  const imgEl = document.getElementById('spectator-img');
  const noEl = document.getElementById('spectator-no-chip');
  const koEl = document.getElementById('spectator-ko-name');
  const enEl = document.getElementById('spectator-en-name');
  const metaGridEl = document.getElementById('spectator-meta-grid');

  if (imgEl) {
    imgEl.src = meta.imageUrl;
    imgEl.alt = meta.koName;
  }
  if (noEl) noEl.innerText = profileSpec.badgeNo;
  if (koEl) koEl.innerText = meta.koName;
  if (enEl) enEl.innerText = profileSpec.subtitle;

  if (metaGridEl) {
    metaGridEl.innerHTML = profileSpec.fields.map((f) => `
      <div class="spectator-meta-item" title="${escapeHtml(f.value)}">
        <span class="spectator-meta-label">${escapeHtml(f.label)}</span>
        <strong>${escapeHtml(f.value)}</strong>
      </div>
    `).join('');
  }

  if (cardEl) {
    cardEl.classList.remove('pulse-scale');
    void cardEl.offsetWidth;
    cardEl.classList.add('pulse-scale');
  }

  document.querySelectorAll('.pool-badge').forEach((badge) => {
    const bCharId = parseInt(badge.dataset.charId, 10);
    if (bCharId === nextItem.charId) {
      badge.style.transform = 'scale(1.18)';
      badge.style.boxShadow = '0 0 0 2.5px #ec4899';
      badge.style.zIndex = '10';
    } else {
      badge.style.transform = 'none';
      badge.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
      badge.style.zIndex = '1';
    }
  });
}

function terminateSpectatorSession() {
  stopAllSessionTimers();
  resetToMainModeSelection();
}

window.exitQuizTrigger = function () {
  if (isTimeUp) return;

  const wasPaused = isPaused;
  const wasInterval = Boolean(timerInterval);
  const wasSpectatorInterval = Boolean(spectatorIntervalId);

  stopAllSessionTimers();

  const promptMsg = currentMode === 'spectator'
    ? '관전을 종료하고 메인 화면으로 돌아가시겠습니까?'
    : '현재 세션을 중단하고 메인 화면으로 돌아가시겠습니까?';

  if (confirm(promptMsg)) {
    if (isTriviaSetSession) {
      terminateTriviaSetSession(false);
    } else if (currentMode === 'study') {
      terminateQuizSession();
    } else if (currentMode === 'record') {
      srCurrentIndex = 0;
      terminateSpeedrunSession();
    } else {
      terminateSpectatorSession();
    }
  } else if (!wasPaused) {
    isPaused = false;
    if (wasInterval) {
      if (isTriviaSetSession) timerInterval = setInterval(tickTriviaTimer, 1000);
      else if (currentMode === 'study') timerInterval = setInterval(tickSessionTimer, 1000);
      else if (currentMode === 'record') timerInterval = setInterval(tickSpeedrunTimer, 1000);
      else timerInterval = setInterval(tickSpectatorSessionTimer, 1000);
    }
    if (wasSpectatorInterval && currentMode === 'spectator') {
      const intervalMs = (userConfig.spectatorInterval || 2) * 1000;
      spectatorIntervalId = setInterval(tickSpectator, intervalMs);
    }
  }
};

window.pauseGameTrigger = function () {
  if (isTimeUp) return;

  const pauseBtn = document.getElementById('header-pause-btn');
  const optionsContainer = document.getElementById('options');

  if (!isPaused) {
    stopAllSessionTimers();
    isPaused = true;

    if (optionsContainer) {
      optionsContainer.style.pointerEvents = 'none';
      optionsContainer.style.opacity = '0.45';
    }

    if (pauseBtn) {
      pauseBtn.setAttribute('aria-label', '재개');
      pauseBtn.setAttribute('title', '재개');
      pauseBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 1.3rem; color: #16a34a;">play_arrow</span>';
      pauseBtn.style.background = '#dcfce7';
      pauseBtn.style.borderColor = '#86efac';
    }
  } else {
    isPaused = false;
    if (isTriviaSetSession) {
      timerInterval = setInterval(tickTriviaTimer, 1000);
    } else if (currentMode === 'study') {
      timerInterval = setInterval(tickSessionTimer, 1000);
    } else if (currentMode === 'record') {
      timerInterval = setInterval(tickSpeedrunTimer, 1000);
    } else {
      timerInterval = setInterval(tickSpectatorSessionTimer, 1000);
      const intervalMs = (userConfig.spectatorInterval || 2) * 1000;
      spectatorIntervalId = setInterval(tickSpectator, intervalMs);
    }

    if (optionsContainer) {
      optionsContainer.style.pointerEvents = 'auto';
      optionsContainer.style.opacity = '1';
    }

    if (pauseBtn) {
      pauseBtn.setAttribute('aria-label', '일시정지');
      pauseBtn.setAttribute('title', '일시정지');
      pauseBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 1.3rem;">pause</span>';
      pauseBtn.style.background = '';
      pauseBtn.style.borderColor = '';
    }
  }
};

function resetToMainModeSelection() {
  stopAllSessionTimers();
  isTriviaSetSession = false;

  const headerQuizControl = document.getElementById('header-quiz-control');
  if (headerQuizControl) headerQuizControl.style.display = 'none';

  document.querySelector('.user-info-right')?.classList.remove('hidden');

  const mainBox = document.getElementById('main-box');
  if (mainBox) {
    mainBox.innerHTML = buildMainSelectionHtml();
    updateVisualBadges(userConfig);
    startInfoCardFloatingChars();
  }

  updateHeaderControlBadges();
  updateReviewCountBadge();
}

function updateHistoryBarUI() {
  const container = document.getElementById('history-bar');
  if (!container) return;
  container.innerHTML = '';

  sessionHistory.slice(-5).forEach((item) => {
    const meta = getCharacterById(item.charId, item.domain || userConfig.currentDomain);
    const chip = document.createElement('div');
    chip.className = `history-chip ${item.isCorrect ? 'correct' : 'wrong'}`;
    const shortName = meta
      ? ((meta.enName && userConfig.nameLang === 'en') ? meta.enName.split(' ')[0] : meta.koName.replace(/\(.*\)/, '').trim())
      : `#${item.charId + 1}`;
    chip.innerHTML = `${meta ? `<img src="${meta.imageUrl}" alt="" />` : ''}<span>${escapeHtml(shortName)}</span>`;
    container.appendChild(chip);
  });
}

function updatePoolIndicatorUI() {
  const weightDisplay = document.getElementById('weight-display');
  if (!weightDisplay || isTimeUp) return;

  const domain = userConfig.currentDomain;
  weightDisplay.innerHTML = '';
  weightDisplay.style.color = '#334155';

  currentPool.forEach((item) => {
    const meta = getCharacterById(item.charId, domain) || item;
    const badge = document.createElement('div');
    badge.className = 'pool-badge';
    badge.dataset.charId = String(item.charId);
    badge.title = `${getCharacterPlainName(meta, userConfig.nameLang)} (Lv.${item.stage || 0})`;
    badge.style.backgroundColor = getStageColor(item.stage);

    if (item.hasBeenPromotedThisSession) {
      badge.style.border = '2.5px solid #16a34a';
    } else if (item.isEligibleForPromotion) {
      badge.style.border = '1.5px solid #16a34a';
    } else if (!item.hasHistory) {
      badge.style.border = '1.5px dashed #94a3b8';
    } else {
      badge.style.border = '1px solid rgba(15, 23, 42, 0.1)';
    }

    badge.innerHTML = `<img src="${meta.imageUrl}" alt="${escapeHtml(meta.koName)}" />`;
    weightDisplay.appendChild(badge);
  });
}

window.addEventListener('beforeunload', (event) => {
  if (timerInterval && !isTimeUp && currentPool.length > 0 && currentMode !== 'spectator' && !isTriviaSetSession) {
    const domain = userConfig.currentDomain;
    if (currentMode === 'study') {
      saveSessionPoolState(domain, currentPool);
      const playedTime = Math.max(0, userConfig.learningTime - timeLeft);
      updateDailyStudyTime(playedTime, domain);
    } else {
      const itemsToSave = currentPool.filter((item) => item.isUnlocked);
      if (itemsToSave.length > 0) saveSessionPoolState(domain, itemsToSave);
      updateDailyStudyTime(srElapsedTime, domain);
    }
    event.preventDefault();
    event.returnValue = '';
  }
});

/**
 * 상단 [도메인 전환] 버튼(단축키 1): 산리오 ↔ 티니핑 전환
 */
window.toggleDomain = function () {
  const idx = DOMAINS.indexOf(userConfig.currentDomain);
  userConfig.currentDomain = DOMAINS[(idx + 1) % DOMAINS.length];
  updateHeaderControlBadges();
  saveUserConfig(userConfig);
  resetToMainModeSelection();
};

/**
 * 메인 안내 카드 내 티니핑 시즌 빠른 변경 드롭다운 핸들러
 */
window.changeTeeniepingSeasonQuick = function (seasonVal) {
  userConfig.teeniepingSeason = seasonVal || 'all';
  saveUserConfig(userConfig);
  resetToMainModeSelection();
};

/**
 * 상단 [출제 방식] 버튼(단축키 2): 그림 → 이름 → 교차 → 질문 순환
 */
window.toggleQuizDirection = function () {
  const idx = QUIZ_DIRECTIONS.indexOf(userConfig.quizDirection);
  userConfig.quizDirection = QUIZ_DIRECTIONS[(idx + 1) % QUIZ_DIRECTIONS.length];
  updateHeaderControlBadges();
  saveUserConfig(userConfig);
  resetToMainModeSelection();
};

/* ==========================================================================
   원격 모달 마운트 (progress, setting, leaderboard, help, login)
   ========================================================================== */
/* ---------- 학습 결과표 (QuizApp Common GUI 「학습 결과」) ---------- */
let sessionStartSnapshot = {}; // 학습 시작 때 캐릭터별 {stage, hadHistory, avgBefore}

/** 최근 응답 속도 평균(초). 기록이 없으면 null */
function averageLatencySec(item) {
  const list = item?.recentLatencies || [];
  if (!list.length) return null;
  return list.reduce((a, b) => a + b, 0) / list.length / 1000;
}

/**
 * 학습이 끝난 뒤 캐릭터별 요약과 총합. 캐릭터 | 맞힘/푼 수 | 평균 응답속도 이전 → 이번 | 상태
 * 상태: 새캐릭터(처음 나온 것), 승급, 강급, 강급후보(틀렸거나 느려짐), 유지. 게스트는 아래에 로그인 안내
 */
function showStudySummary() {
  const byChar = new Map();
  sessionHistory.forEach((h) => {
    const row = byChar.get(h.charId) || { charId: h.charId, correct: 0, solved: 0 };
    row.solved += 1;
    if (h.isCorrect) row.correct += 1;
    byChar.set(h.charId, row);
  });
  if (byChar.size === 0) return;

  const fmt = (v) => (v === null || v === undefined ? '-' : v.toFixed(1));
  const rows = [...byChar.values()].map((row) => {
    const before = sessionStartSnapshot[row.charId] || { stage: 0, hadHistory: false, avgBefore: null };
    const item = currentPool.find((p) => p.charId === row.charId);
    const avgAfter = averageLatencySec(item);
    const stageAfter = item ? item.stage : before.stage;
    let status = 'keep';
    if (!before.hadHistory) status = 'new';
    else if (stageAfter > before.stage) status = 'up';
    else if (stageAfter < before.stage) status = 'down';
    else if (row.correct < row.solved || (before.avgBefore !== null && avgAfter !== null && avgAfter > before.avgBefore)) status = 'risk';
    return { ...row, name: item?.koName || String(row.charId), avgBefore: before.hadHistory ? before.avgBefore : null, avgAfter, status };
  });

  const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
  const total = {
    correct: rows.reduce((n, r) => n + r.correct, 0),
    solved: rows.reduce((n, r) => n + r.solved, 0),
    avgBefore: mean(rows.map((r) => r.avgBefore).filter((v) => v !== null)),
    avgAfter: mean(rows.map((r) => r.avgAfter).filter((v) => v !== null))
  };
  const statusLabel = { new: '새캐릭터', up: '승급', down: '강급', risk: '강급후보', keep: '유지' };
  const body = rows.map((r) => `
    <tr>
      <td class="sum-char sum-name">${escapeHtml(r.name)}</td>
      <td>${r.correct} / ${r.solved}</td>
      <td>${fmt(r.avgBefore)} → ${fmt(r.avgAfter)}</td>
      <td><span class="sum-status sum-${r.status}">${statusLabel[r.status]}</span></td>
    </tr>`).join('');
  const loginNote = canSubmitRanking() ? '' : `
    <div class="ranking-login-note">
      <span>로그인하면 지금까지 게스트로 학습한 기록이 계정에 합쳐져 다른 기기에서도 이어서 할 수 있고, 다음 기록부터 리더보드에도 올라갑니다.</span>
      <button type="button" class="ranking-login-btn">로그인</button>
    </div>`;

  document.querySelector('.info-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'inbox-overlay info-overlay';
  overlay.innerHTML = `
    <div class="inbox-card" role="dialog" aria-label="학습 결과">
      <div class="inbox-header">
        <h4>학습 결과</h4>
        <button type="button" class="inbox-close" aria-label="닫기">&times;</button>
      </div>
      <div class="info-overlay-body">
        <table class="study-summary-table">
          <thead><tr><th>캐릭터</th><th>맞힘</th><th>응답속도(초)</th><th>상태</th></tr></thead>
          <tbody>${body}</tbody>
          <tfoot><tr><td>총계</td><td>${total.correct} / ${total.solved}</td><td>${fmt(total.avgBefore)} → ${fmt(total.avgAfter)}</td><td></td></tr></tfoot>
        </table>
        <p class="study-summary-note">응답속도는 최근 기록 평균입니다. 강급후보는 이번에 틀렸거나 전보다 느려진 캐릭터입니다.</p>
        ${loginNote}
      </div>
    </div>`;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('.inbox-close')) overlay.remove();
    else if (e.target.closest('.ranking-login-btn')) {
      overlay.remove();
      window.popupLogin();
    }
  });
  document.body.appendChild(overlay);
}

/* ---------- 콤보 기록 (QuizApp Common GUI 「콤보 기록」) ---------- */
let comboState = { current: 0, best: 0, bestAt: null }; // 판·날짜가 바뀌어도 이어지는 연속 정답과 역대 최대
let comboRange = 'week';

/** 학습 모드 답 하나를 이어지는 콤보에 반영한다 */
function trackRunningCombo(isCorrect) {
  if (!isCorrect) {
    comboState.current = 0;
    return;
  }
  comboState.current += 1;
  if (comboState.current > comboState.best) {
    comboState.best = comboState.current;
    comboState.bestAt = toLocalDateKey();
  }
}

/** 이번 판에서 가장 길게 이어진 정답 수 */
function getSessionMaxCombo(history) {
  let best = 0;
  let run = 0;
  history.forEach((h) => {
    run = h.isCorrect ? run + 1 : 0;
    best = Math.max(best, run);
  });
  return best;
}

/** 학습현황의 최대 콤보 그래프(주·월·년)와 역대 최대 */
async function renderComboStats(range) {
  comboRange = range;
  document.querySelectorAll('.combo-range-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.range === range));
  const entries = await getComboHistory(range);
  renderComboChart(entries, comboState);
}

/**
 * 휴대폰의 공유하기 서랍을 연다(카톡·문자 등). 서랍이 없는 브라우저는 주소를 복사한다.
 * resultText 를 주면 타임어택 결과 문구를 함께 보낸다(복사할 때도 문구 + 주소).
 */
async function shareApp(resultText = null) {
  const url = new URL('./', window.location.href).href;
  const shareData = { title: 'NameQuiz', text: resultText || '산리오·티니핑 캐릭터 이름을 맞히는 퀴즈 앱', url };
  if (navigator.share) {
    try {
      await navigator.share(shareData);
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.warn('[Share] 공유 서랍 실패, 주소 복사로 바꿉니다:', error);
    }
  }
  try {
    await navigator.clipboard.writeText(resultText ? `${resultText}\n${url}` : url);
    alert(resultText ? '결과와 주소를 복사했어요. 카톡이나 문자에 붙여 넣어 보내세요.' : '주소를 복사했어요. 카톡이나 문자에 붙여 넣어 보내세요.');
  } catch (error) {
    alert(`공유하지 못했어요.\n${url}`);
  }
}

const ACCENT_COLORS = ['pink', 'blue', 'green', 'purple', 'orange'];

/** 테마색(강조색)을 화면 전체에 적용한다. 바탕·글자색은 그대로이고 강조 부분만 바뀐다 */
function applyAccentColor(name) {
  const accent = ACCENT_COLORS.includes(name) ? name : 'pink';
  document.documentElement.dataset.accent = accent;
  // index.html 이 다음에 열 때 설정을 읽기 전부터 같은 색으로 그리도록 기기에도 적어 둔다
  try { localStorage.setItem('NAMEQUIZ_ACCENT', accent); } catch { /* 무시 */ }
}

async function openRemoteModalPopup(viewName, options = {}) {
  if (timerInterval && !isTimeUp) return;

  try {
    const versionQuery = (window.CACHE_BUST || window.APP_VERSION) ? `?v=${window.CACHE_BUST || window.APP_VERSION}` : '';
    const response = await fetch(`./view/${viewName}.html${versionQuery}`);
    if (!response.ok) throw new Error(`${viewName}.html 로드 실패`);

    let htmlContent = await response.text();

    if (viewName === 'setting') {
      const rawTimeIdx = TIME_STEPS.indexOf(userConfig.learningTime);
      const timeIdx = rawTimeIdx >= 0 ? rawTimeIdx : 4;

      let userName = auth.currentUser ? (auth.currentUser.displayName || '이름 없음') : '게스트';
      if (userName.includes('(')) userName = userName.split('(')[0].trim();

      const maskedEmail = formatUserEmailForDisplay(auth.currentUser);
      const kbHtml = generateKeybindingsHtml(userConfig);

      htmlContent = htmlContent
        .replace('{{userName}}', () => escapeHtml(userName))
        .replace('{{userEmail}}', () => escapeHtml(maskedEmail))
        .replace('{{timeIdx}}', String(timeIdx))
        .replace('{{learningTime}}', String(userConfig.learningTime))
        .replace('{{MAX_POOL_SIZE}}', String(userConfig.MAX_POOL_SIZE))
        .replace('{{#if autoProgress}}checked{{/if}}', userConfig.autoProgress ? 'checked' : '')
        .replace('{{targetAccuracyIdx}}', String(TARGET_ACCURACY_STEPS.indexOf(normalizeTargetAccuracy(userConfig.targetAccuracy))))
        .replace('{{targetAccuracy}}', String(normalizeTargetAccuracy(userConfig.targetAccuracy)))
        .replace('{{recentAccuracy}}', () => recentAccuracyHintText())
        .replace('{{#if weatherTheme}}checked{{/if}}', userConfig.weatherTheme !== false ? 'checked' : '')
        .replace('{{keybindingsConfig}}', () => kbHtml);
    }

    const domMeta = DOMAIN_META[userConfig.currentDomain] || DOMAIN_META.sanrio;
    const viewTitles = {
      help: '도움말',
      leaderboard: '리더보드',
      setting: '환경설정',
      progress: domMeta.pokedexTitle,
      login: auth.currentUser ? '로그인 계정' : '간편 로그인'
    };

    const isSetting = viewName === 'setting';
    const isFullScreen = ['setting', 'leaderboard', 'progress', 'help'].includes(viewName);
    const versionIsNew = isSetting && hasUnseenVersion();

    const overlay = document.createElement('div');
    overlay.className = isFullScreen ? 'modal-overlay full-screen' : 'modal-overlay';
    overlay.innerHTML = isFullScreen ? `
      <div class="modal-content">
        <div class="modal-header full-screen-header">
          <div class="full-screen-title">
            ${isSetting ? `
            <button type="button" class="setting-tool-btn install-app-btn install-has-dot" title="앱 설치" aria-label="앱 설치" hidden>
              <span class="material-symbols-outlined">install_desktop</span>
            </button>` : ''}
            <h3 class="modal-title">${isSetting ? 'NameQuiz' : (viewTitles[viewName] || '안내')}</h3>
          </div>
          <div class="setting-toolbar">
            ${isSetting ? `
            <button type="button" class="setting-tool-btn" id="setting-inbox-btn" title="알림함" aria-label="알림함">
              <span class="material-symbols-outlined">notifications</span>
              <span class="inbox-unread-badge" hidden></span>
            </button>
            <button type="button" class="setting-tool-btn" id="setting-help-btn" title="앱 정보·도움말" aria-label="앱 정보·도움말">
              <span class="material-symbols-outlined">info</span>
              ${versionIsNew ? '<span class="setting-new-dot"></span>' : ''}
            </button>
            <button type="button" class="setting-tool-btn" id="setting-share-btn" title="공유하기" aria-label="공유하기">
              <span class="material-symbols-outlined">share</span>
            </button>` : ''}
            <button type="button" class="modal-close setting-tool-btn" title="닫기" aria-label="닫기">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>
        <div class="modal-body">${htmlContent}</div>
      </div>
    ` : `
      <div class="modal-content">
        <div class="modal-header">
          <h3 class="modal-title">${viewTitles[viewName] || '안내'}</h3>
          <div class="modal-header-actions">
            <button type="button" class="modal-close" aria-label="닫기">&times;</button>
          </div>
        </div>
        <div class="modal-body">${htmlContent}</div>
      </div>
    `;

    overlay.addEventListener('click', (e) => {
      if (e.target.closest('.modal-close') || e.target === overlay) {
        document.querySelector('.char-detail-overlay')?.remove();
        overlay.remove();
        if (viewName === 'setting') {
          saveUserConfig(userConfig);
          updateHeaderControlBadges();
          resetToMainModeSelection();
        }
        if (viewName === 'leaderboard') {
          if (window.highlightRemaining > 0) window.highlightRemaining--;
          if (!window.highlightRemaining || window.highlightRemaining <= 0) {
            window.highlightRecordId = null;
          }
        }
        if (options?.returnTo) {
          openRemoteModalPopup(options.returnTo);
        }
      }
    });

    document.body.appendChild(overlay);

    if (viewName === 'progress') {
      const domain = userConfig.currentDomain;
      const refreshPokedexView = async (seasonVal) => {
        if (domain === 'teenieping') {
          userConfig.teeniepingSeason = seasonVal;
          saveUserConfig(userConfig);
          if (document.getElementById('mode-selection-layer')) {
            const mainBox = document.getElementById('main-box');
            if (mainBox) {
              mainBox.innerHTML = buildMainSelectionHtml();
              startInfoCardFloatingChars();
            }
          }
        }
        const activeSeason = getActiveSeasonFilter();
        const currentDomainData = await getAllProgress(domain);
        renderSeasonTabsInModal(domain, activeSeason, refreshPokedexView);
        await renderResponseTimeChart(domain, activeSeason);
        renderProgressTable(domain, currentDomainData, activeSeason);
        updateReviewCountBadge();
      };

      await refreshPokedexView(getActiveSeasonFilter());
      await renderComboStats(comboRange);
      overlay.querySelectorAll('.combo-range-tab').forEach((tab) => {
        tab.addEventListener('click', (e) => {
          e.stopPropagation();
          renderComboStats(tab.dataset.range);
        });
      });
    }

    if (viewName === 'leaderboard') {
      const targetFilter = window.targetLeaderboardDomain || getDefaultLeaderboardFilter();
      window.targetLeaderboardDomain = targetFilter;
      const mode = window.currentLeaderboardMode || 'speedrun';
      const domainSelect = document.getElementById('leaderboard-domain-select');
      if (domainSelect) domainSelect.value = targetFilter;

      const rankings = mode === 'timeattack'
        ? await getTimeAttackRankings(10, targetFilter)
        : await getGlobalRankings(10, targetFilter);
      renderLeaderboardUI(rankings, mode);
    }

    if (viewName === 'login') {
      renderLoginModalState(auth.currentUser);
    }

    if (viewName === 'help') {
      // QuizQuiz 자매품 홍보는 도움말 맨 위 (quiz_apps 목록에서 이 앱을 뺀 나머지)
      overlay.querySelector('.modal-body')?.insertAdjacentHTML('afterbegin', renderSisterAppsHtml());
      hydrateSisterApps(overlay);
      overlay.querySelector('.modal-body')?.insertAdjacentHTML('beforeend', `
        <div class="app-version-box">
          <div><span>프로그램 버전</span><b>NameQuiz ${window.APP_VERSION || '-'}</b></div>
          <div><span>빌드</span><b>${window.CACHE_BUST || '-'}</b></div>
          <div><span>QuizApp Common GUI</span><b>${window.QUIZAPP_GUI_VERSION || '-'}</b></div>
        </div>`);
    }

    if (viewName === 'setting') {
      markVersionSeen();
      updateInboxBadge();
      refreshInstallButtons();
      overlay.querySelector('#setting-inbox-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openInboxModal({
          onStartStudy: () => {
            saveUserConfig(userConfig);
            overlay.remove();
            startStudyFromInbox();
          }
        });
      });
      overlay.querySelector('#setting-share-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        shareApp();
      });

      overlay.querySelector('#weather-theme')?.addEventListener('change', (e) => {
        userConfig.weatherTheme = e.target.checked;
        applyWeatherToInfoCard();
      });

      // 테마색(강조색)
      const accentSwatches = overlay.querySelectorAll('.accent-swatch');
      const markAccent = () => accentSwatches.forEach((sw) => sw.setAttribute('aria-checked', String(sw.dataset.accent === (userConfig.accentColor || 'pink'))));
      markAccent();
      accentSwatches.forEach((sw) => sw.addEventListener('click', (e) => {
        e.stopPropagation();
        userConfig.accentColor = sw.dataset.accent;
        applyAccentColor(userConfig.accentColor);
        markAccent();
        saveUserConfig(userConfig);
      }));

      overlay.querySelector('#setting-help-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        saveUserConfig(userConfig);
        overlay.remove();
        openRemoteModalPopup('help', { returnTo: 'setting' });
      });

      const syncConditionalSettingRows = () => {
        const isTeenieping = userConfig.currentDomain === 'teenieping';
        document.getElementById('setting-teenieping-season-row')?.classList.toggle('hidden', !isTeenieping);
        document.getElementById('setting-sanrio-lang-row')?.classList.toggle('hidden', isTeenieping);
      };

      const domainSelect = document.getElementById('domain-select');
      if (domainSelect) domainSelect.value = userConfig.currentDomain;
      domainSelect?.addEventListener('change', (e) => {
        userConfig.currentDomain = e.target.value;
        updateHeaderControlBadges();
        syncConditionalSettingRows();
      });

      const seasonSelect = document.getElementById('teenieping-season-select');
      if (seasonSelect) seasonSelect.value = userConfig.teeniepingSeason || 'all';
      seasonSelect?.addEventListener('change', (e) => {
        userConfig.teeniepingSeason = e.target.value || 'all';
      });

      syncConditionalSettingRows();

      const ageSelect = document.getElementById('user-age');
      if (ageSelect) ageSelect.value = userConfig.age || '미상';
      ageSelect?.addEventListener('change', (e) => { userConfig.age = e.target.value || '미상'; });

      const genderSelect = document.getElementById('user-gender');
      if (genderSelect) genderSelect.value = userConfig.gender || '미상';
      genderSelect?.addEventListener('change', (e) => { userConfig.gender = e.target.value || '미상'; });

      const quizDirSelect = document.getElementById('quiz-direction-select');
      if (quizDirSelect) quizDirSelect.value = userConfig.quizDirection || 'mixed';
      quizDirSelect?.addEventListener('change', (e) => {
        userConfig.quizDirection = e.target.value;
        updateHeaderControlBadges();
      });

      const triviaCountSelect = document.getElementById('trivia-count-select');
      if (triviaCountSelect) triviaCountSelect.value = String(userConfig.triviaQuestionCount || 10);
      triviaCountSelect?.addEventListener('change', (e) => {
        userConfig.triviaQuestionCount = parseInt(e.target.value, 10) || 10;
      });

      const triviaShowNameCheck = document.getElementById('trivia-show-name');
      if (triviaShowNameCheck) triviaShowNameCheck.checked = userConfig.triviaShowName !== false;
      triviaShowNameCheck?.addEventListener('change', (e) => {
        userConfig.triviaShowName = e.target.checked;
      });

      const nameLangSelect = document.getElementById('name-lang-select');
      if (nameLangSelect) nameLangSelect.value = userConfig.nameLang || 'ko';
      nameLangSelect?.addEventListener('change', (e) => {
        userConfig.nameLang = e.target.value;
      });

      const spectatorIntervalSelect = document.getElementById('spectator-interval');
      if (spectatorIntervalSelect) spectatorIntervalSelect.value = String(userConfig.spectatorInterval || 2);
      spectatorIntervalSelect?.addEventListener('change', (e) => {
        userConfig.spectatorInterval = parseFloat(e.target.value) || 2;
      });

      const btnErrorShow = document.getElementById('btn-error-show');
      const syncErrorBtn = () => {
        if (!btnErrorShow) return;
        const isNone = userConfig.errorFeedbackMode === 'none';
        btnErrorShow.innerText = isNone ? '무시 (바로 다음 문제)' : '정답 표시 (0.9초)';
        btnErrorShow.style.background = isNone ? '#94a3b8' : '#10b981';
      };
      syncErrorBtn();
      btnErrorShow?.addEventListener('click', () => {
        userConfig.errorFeedbackMode = userConfig.errorFeedbackMode === 'none' ? 'show' : 'none';
        syncErrorBtn();
      });

      document.getElementById('pool-size')?.addEventListener('input', (e) => {
        const raw = parseInt(e.target.value, 10) || 10;
        userConfig.MAX_POOL_SIZE = Math.min(50, Math.max(4, raw));
      });

      document.getElementById('auto-progress')?.addEventListener('change', (e) => {
        userConfig.autoProgress = e.target.checked;
      });

      document.getElementById('target-accuracy-slider')?.addEventListener('input', (e) => {
        userConfig.targetAccuracy = TARGET_ACCURACY_STEPS[parseInt(e.target.value, 10)] ?? DEFAULT_TARGET_ACCURACY;
        const display = document.getElementById('target-accuracy-display');
        if (display) display.textContent = String(userConfig.targetAccuracy);
      });

      bindNotificationSetting(overlay);

      bindKeybindingSettingsEvents(overlay, userConfig);
    }
  } catch (error) {
    console.error('모달 로드 중 오류 발생:', error);
  }
}

const NOTIFICATION_STATUS_TEXT = {
  off: '받지 않음',
  granted: '켜짐',
  default: '알림 권한이 필요합니다',
  denied: '차단됨 · 기기 설정에서 허용해 주세요',
  'ios-install-required': '홈 화면에 추가한 앱에서 켤 수 있습니다',
  unsupported: '이 브라우저는 지원하지 않습니다',
  failed: '켜지 못했습니다 · 다시 시도해 주세요'
};

const REMINDER_FAIL_TEXT = {
  token: '알림 서버에 연결하지 못함',
  server: '예약 서버 오류',
  network: '예약 서버에 연결하지 못함'
};

/**
 * 마지막 복습 알림 예약 결과 한 줄. 예약이 조용히 실패해도 설정 화면에서 알 수 있게 한다.
 */
function renderLastReminder(el) {
  const last = getLastReminderResult();
  if (!el || !last) return;
  const fmt = (ms) => new Date(ms).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  el.textContent = last.ok
    ? `마지막 예약: ${fmt(last.dueAt)} 알림 예정`
    : `마지막 예약 실패 (${fmt(last.at)}) · ${REMINDER_FAIL_TEXT[last.reason] || '알 수 없는 오류'}`;
  el.dataset.ok = String(last.ok);
  el.hidden = false;
}

/**
 * 설정 모달의 「복습 알림」 줄 (Common GUI push 규칙).
 * - 체크박스: 복습 알림을 받을지(userConfig.reviewReminder). 끄면 이후 학습을 마쳐도 예약하지 않는다.
 * - 권한 허용 버튼: 받기로 했는데 권한이 아직 없을 때만 보인다. 권한 요청은 사용자가 누를 때만 한다.
 */
function bindNotificationSetting(root) {
  const statusEl = root.querySelector('#notify-status');
  const btn = root.querySelector('#btn-notify-enable');
  const toggle = root.querySelector('#review-reminder');
  const lastEl = root.querySelector('#notify-last');
  if (!statusEl || !btn || !toggle) return;

  const askPermission = async () => {
    // 사용자 동작 안에서 곧바로 권한을 요청해야 아이폰 홈 화면 앱에서도 권한 창이 뜬다
    const token = await requestNotificationPermission();
    render(!token && getNotificationState() === 'granted' ? 'failed' : undefined);
  };

  const render = (override) => {
    const enabled = userConfig.reviewReminder !== false;
    const state = enabled ? (override || getNotificationState()) : 'off';
    toggle.checked = enabled;
    statusEl.textContent = NOTIFICATION_STATUS_TEXT[state] || '';
    statusEl.dataset.state = state;
    btn.hidden = !(enabled && (state === 'default' || state === 'failed'));
    if (lastEl) {
      lastEl.hidden = true;
      if (enabled) renderLastReminder(lastEl);
    }
  };

  toggle.addEventListener('change', () => {
    userConfig.reviewReminder = toggle.checked;
    saveUserConfig(userConfig);
    render();
    // 켜는 순간 권한이 아직 없으면 같은 동작 안에서 바로 묻는다
    if (toggle.checked && getNotificationState() === 'default') askPermission();
  });

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    await askPermission();
    btn.disabled = false;
  });

  render();
}

window.popupHelp = () => openRemoteModalPopup('help');
window.popupLeaderboard = (domain = null, mode = 'speedrun') => {
  window.targetLeaderboardDomain = domain || getDefaultLeaderboardFilter();
  window.currentLeaderboardMode = mode;
  openRemoteModalPopup('leaderboard');
};
window.popupSetting = () => openRemoteModalPopup('setting');
window.popupProgress = () => openRemoteModalPopup('progress');
window.popupLogin = () => openRemoteModalPopup('login');
window.popupInbox = () => openInboxModal({ onStartStudy: startStudyFromInbox });

window.changeLeaderboardDomain = async function (targetDomain) {
  window.targetLeaderboardDomain = targetDomain;
  const mode = window.currentLeaderboardMode || 'speedrun';
  if (mode === 'hints') {
    ['tab-speedrun', 'tab-timeattack'].forEach((id) => document.getElementById(id)?.classList.remove('active'));
    document.getElementById('tab-hints')?.classList.add('active');
    await renderHintHallOfFame();
    return;
  }
  const listContainer = document.getElementById('leaderboard-list');
  if (listContainer) {
    const colCount = 6;
    listContainer.innerHTML = `<tr><td colspan="${colCount}" class="leaderboard-empty">데이터를 불러오는 중입니다...</td></tr>`;
  }
  const rankings = mode === 'timeattack'
    ? await getTimeAttackRankings(10, targetDomain)
    : await getGlobalRankings(10, targetDomain);
  renderLeaderboardUI(rankings, mode);
};

window.switchLeaderboardMode = async function (mode) {
  window.currentLeaderboardMode = mode;
  if (mode === 'hints') {
    ['tab-speedrun', 'tab-timeattack'].forEach((id) => document.getElementById(id)?.classList.remove('active'));
    document.getElementById('tab-hints')?.classList.add('active');
    await renderHintHallOfFame();
    return;
  }
  const targetDomain = window.targetLeaderboardDomain || getDefaultLeaderboardFilter();
  const listContainer = document.getElementById('leaderboard-list');
  if (listContainer) {
    const colCount = 6;
    listContainer.innerHTML = `<tr><td colspan="${colCount}" class="leaderboard-empty">데이터를 불러오는 중입니다...</td></tr>`;
  }
  const rankings = mode === 'timeattack'
    ? await getTimeAttackRankings(10, targetDomain)
    : await getGlobalRankings(10, targetDomain);
  renderLeaderboardUI(rankings, mode);
};

window.googleLogin = () => googleLogin(resetToMainModeSelection);
window.kakaoLogin = kakaoLogin;
window.naverLogin = naverLogin;
window.logout = () => logoutUser(resetToMainModeSelection);

window.activateSingleCharProgress = async function (domain = userConfig.currentDomain, charId) {
  const activeSeason = domain === 'teenieping' ? (userConfig.teeniepingSeason || 'all') : 'all';
  const updatedDomainData = await activateSingleCharInDb(domain, charId);
  if (updatedDomainData) {
    renderProgressTable(domain, updatedDomainData, activeSeason);
    await renderResponseTimeChart(domain, activeSeason);
    updateReviewCountBadge();
  }
};

window.resetSingleCharProgress = async function (domain = userConfig.currentDomain, charId) {
  const activeSeason = domain === 'teenieping' ? (userConfig.teeniepingSeason || 'all') : 'all';
  const updatedDomainData = await resetSingleCharInDb(domain, charId);
  if (updatedDomainData) {
    renderProgressTable(domain, updatedDomainData, activeSeason);
    await renderResponseTimeChart(domain, activeSeason);
    updateReviewCountBadge();
  }
};

window.unlockAllCharacters = async function () {
  const domain = userConfig.currentDomain;
  const seasonFilter = getActiveSeasonFilter();
  const scopeDesc = (domain === 'teenieping' && seasonFilter !== 'all')
    ? `티니핑 [${seasonFilter}]`
    : (DOMAIN_META[domain]?.title || domain);

  if (!confirm(`${scopeDesc} 범위의 미해금 캐릭터를 모두 Stage 1 단계로 일괄 해금할까요?`)) return;
  const updatedDomainData = await unlockAllCharactersInDb(domain, seasonFilter);
  if (updatedDomainData) {
    renderProgressTable(domain, updatedDomainData, seasonFilter);
    await renderResponseTimeChart(domain, seasonFilter);
    updateReviewCountBadge();
  }
};

window.resetAllProgressData = async function () {
  const domain = userConfig.currentDomain;
  const seasonFilter = getActiveSeasonFilter();
  const scopeDesc = (domain === 'teenieping' && seasonFilter !== 'all')
    ? `티니핑 [${seasonFilter}]`
    : (DOMAIN_META[domain]?.title || domain);

  if (!confirm(`경고: ${scopeDesc} 범위의 모든 학습 기록이 초기화됩니다.\n계속하시겠습니까?`)) return;
  const updatedDomainData = await resetAllProgressInDb(domain, seasonFilter);
  renderProgressTable(domain, updatedDomainData, seasonFilter);
  await renderResponseTimeChart(domain, seasonFilter);
  updateReviewCountBadge();
};

async function updateReviewCountBadge() {
  const badge = document.getElementById('review-count-badge');
  if (!badge) return;

  try {
    // 학습에는 시즌과 상관없이 복습 캐릭터를 내므로 배지도 도메인 전체를 센다
    const domain = userConfig.currentDomain;
    const dbData = await getAllProgress(domain) || {};
    const now = Date.now();
    let count = 0;

    getCharacters(domain, 'all').forEach((meta) => {
      const saved = dbData[String(meta.charId)] || dbData[meta.charId];
      if (saved && isDueForReview(saved, now)) {
        count++;
      }
    });

    if (count > 0) {
      badge.innerText = String(count);
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  } catch {
    badge.style.display = 'none';
  }
}

registerGlobalKeybindings(userConfig, {
  onEscapeModal: (activeOverlay) => activeOverlay.click(),
  onEscapeSpectator: () => window.exitQuizTrigger?.(),
  onEscapeQuiz: () => window.exitQuizTrigger?.(),
  onToggleDomain: () => window.toggleDomain?.(),
  onToggleQuizDirection: () => window.toggleQuizDirection?.(),
  onPopupProgress: () => window.popupProgress?.(),
  onPopupSetting: () => window.popupSetting?.(),
  onPopupLeaderboard: () => window.popupLeaderboard?.(),
  onPopupHelp: () => window.popupHelp?.(),
  onPopupLogin: () => window.popupLogin?.(),
  onStartStudy: () => window.startSessionWorkflow?.('study'),
  onStartRecord: () => window.startSessionWorkflow?.('record'),
  onStartSpectator: () => window.startSessionWorkflow?.('spectator'),
  onPauseResume: () => window.pauseGameTrigger?.(),
  onOptionSelect: (optionIndex) => {
    if (isPaused) return;
    const optionsContainer = document.getElementById('options');
    if (optionsContainer && optionsContainer.style.pointerEvents !== 'none') {
      const buttons = optionsContainer.querySelectorAll('.option-btn');
      if (buttons && buttons.length > optionIndex) {
        buttons[optionIndex].click();
      }
    }
  }
});

/** 설정 화면 「목표 정답률」 옆 안내: 최근 학습 정답률 */
function recentAccuracyHintText() {
  const { accuracy, count } = getRecentStudyAccuracy();
  if (accuracy === null) return '학습 모드에서 10문제 넘게 풀면 최근 정답률에 맞춰 새 캐릭터 수를 조절합니다(늦게 맞힌 답은 틀린 것으로 셉니다).';
  return `최근 ${count}문제 정답률 ${accuracy}%. 목표보다 많이 높으면 새 캐릭터를 더 넣고, 낮으면 복습만 합니다.`;
}
