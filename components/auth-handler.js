/**
 * @file components/auth-handler.js
 * @description 사용자 OAuth 인증(Google, Kakao, Naver) 및 로그인/게스트 세션 상태 관리 모듈 (NAMEQUIZ 네임스페이스)
 */

import { auth } from './firebase-config.js';
import { APP_BASE_URL, ENDPOINTS, OAUTH_CLIENT_IDS } from './app-config.js';
import {
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  signInWithCustomToken
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";

const AUTH_PROVIDER_STORAGE_KEY = 'NAMEQUIZ_AUTH_PROVIDER';
const AUTH_HISTORY_STORAGE_KEY = 'NAMEQUIZ_LOGIN_SUCCESS_HISTORY';
const LOGIN_PENDING_PROVIDER_KEY = 'NAMEQUIZ_LOGIN_PROVIDER';
const KAKAO_EMAIL_SCOPE_KEY = 'NAMEQUIZ_KAKAO_NEEDS_EMAIL_SCOPE';
const VALID_PROVIDERS = ['google', 'kakao', 'naver'];
let isLoginProcessing = false;

window.addEventListener('pageshow', () => {
  isLoginProcessing = false;
});

/**
 * 과거에 로그인 성공한 소셜 플랫폼 목록 조회
 * @returns {Array<'google'|'kakao'|'naver'>}
 */
export function getLoginSuccessHistory() {
  try {
    const raw = localStorage.getItem(AUTH_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => VALID_PROVIDERS.includes(p));
  } catch {
    return [];
  }
}

/**
 * 로그인 성공 소셜 플랫폼 기록
 * @param {'google'|'kakao'|'naver'|null} provider
 */
export function recordLoginSuccess(provider) {
  if (!VALID_PROVIDERS.includes(provider)) return;
  try {
    const history = getLoginSuccessHistory();
    if (!history.includes(provider)) {
      history.push(provider);
      localStorage.setItem(AUTH_HISTORY_STORAGE_KEY, JSON.stringify(history));
    }
  } catch (e) {
    console.warn('[Auth] 로그인 성공 이력 저장 실패:', e);
  }
}

/**
 * 현재 로그인된 사용자의 소셜 플랫폼 식별자 반환
 * @param {object|null} user
 * @returns {'google'|'kakao'|'naver'|null}
 */
export function getActiveAuthProvider(user = auth.currentUser) {
  if (!user) return null;

  const savedProvider = localStorage.getItem(AUTH_PROVIDER_STORAGE_KEY);
  if (VALID_PROVIDERS.includes(savedProvider)) {
    return savedProvider;
  }

  const uid = user.uid || '';
  if (uid.startsWith('kakao:')) return 'kakao';
  if (uid.startsWith('naver:')) return 'naver';

  if (Array.isArray(user.providerData) && user.providerData.some((p) => p.providerId === 'google.com')) {
    return 'google';
  }

  const email = (user.email || '').toLowerCase();
  if (email.endsWith('@kakao.com')) return 'kakao';
  if (email.endsWith('@naver.com')) return 'naver';

  return 'google';
}

/**
 * 화면 표시용 마스킹 이메일 반환
 * @param {object|null} user
 * @returns {string}
 */
export function formatUserEmailForDisplay(user = auth.currentUser) {
  if (!user || !user.email) return '';
  const rawEmail = user.email.trim();
  const parts = rawEmail.split('@');
  if (parts.length !== 2) return rawEmail;

  const [idPart, domainPart] = parts;
  const uid = user.uid || '';

  const isSyntheticKakao = domainPart.toLowerCase() === 'kakao.com' &&
    (uid === `kakao:${idPart}` || /^\d{8,}$/.test(idPart));
  const isSyntheticNaver = domainPart.toLowerCase() === 'naver.com' && uid === `naver:${idPart}`;

  if (isSyntheticKakao || isSyntheticNaver) {
    return '소셜 고유 계정 연동됨';
  }

  const keepLen = Math.ceil(idPart.length / 2);
  return `${idPart.substring(0, keepLen)}${'*'.repeat(idPart.length - keepLen)}@${domainPart}`;
}

// OAuth 리다이렉트 복귀 코드 처리
const urlParams = new URLSearchParams(window.location.search);
const authCode = urlParams.get('code');
const authState = urlParams.get('state');
const loginProvider = localStorage.getItem(LOGIN_PENDING_PROVIDER_KEY);

if (authCode) {
  (async () => {
    const resolvedProvider = loginProvider === 'kakao' ? 'kakao' : 'naver';
    try {
      window.history.replaceState({}, document.title, window.location.pathname);

      const requestBody = { code: authCode, redirectUri: APP_BASE_URL };
      if (authState) requestBody.state = authState;

      const endpoint = resolvedProvider === 'kakao' ? ENDPOINTS.kakaoLogin : ENDPOINTS.naverLogin;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();
      if (data.firebaseToken) {
        localStorage.setItem(AUTH_PROVIDER_STORAGE_KEY, resolvedProvider);
        recordLoginSuccess(resolvedProvider);
        await signInWithCustomToken(auth, data.firebaseToken);
        if (auth.currentUser) {
          await auth.currentUser.reload();
          await auth.currentUser.getIdToken(true);
        }
        if (data.emailNeedsAgreement) {
          localStorage.setItem(KAKAO_EMAIL_SCOPE_KEY, '1');
        } else {
          localStorage.removeItem(KAKAO_EMAIL_SCOPE_KEY);
        }
      } else {
        const providerName = resolvedProvider === 'kakao' ? '카카오' : '네이버';
        console.error(`${resolvedProvider} 로그인 연동 오류:`, data.error || data);
        alert(`${providerName} 로그인 서버 통신이 거절되었습니다. 콘솔 로그를 확인해 주세요.`);
      }
    } catch (error) {
      console.error("리다이렉트 로그인 처리 실패:", error);
      alert("로그인 처리 중 통신 오류가 발생했습니다.");
    } finally {
      localStorage.removeItem(LOGIN_PENDING_PROVIDER_KEY);
    }
  })();
}

export const initAuthObserver = (callback) => {
  onAuthStateChanged(auth, callback);
};

export const googleLogin = async (onSuccess) => {
  if (isLoginProcessing) return;
  isLoginProcessing = true;

  const ua = navigator.userAgent.toLowerCase();
  const isKakao = ua.includes('kakao');
  const isInstagram = ua.includes('instagram');
  const isLine = ua.includes('line');

  if (isKakao || isInstagram || isLine) {
    const currentUrl = window.location.href;
    if (ua.includes('android')) {
      const urlNoProtocol = currentUrl.replace(/https?:\/\//, '');
      location.href = `intent://${urlNoProtocol}#Intent;scheme=https;package=com.android.chrome;end`;
      isLoginProcessing = false;
      return;
    } else if (isKakao) {
      location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(currentUrl);
      isLoginProcessing = false;
      return;
    } else {
      alert("인앱 브라우저에서는 Google 로그인이 제한됩니다. 우측 상단 메뉴에서 '기본 브라우저로 열기'를 선택해 주세요.");
      isLoginProcessing = false;
      return;
    }
  }

  try {
    const provider = new GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/userinfo.profile');
    provider.addScope('https://www.googleapis.com/auth/userinfo.email');

    localStorage.setItem(AUTH_PROVIDER_STORAGE_KEY, 'google');
    await signInWithPopup(auth, provider);
    recordLoginSuccess('google');
    if (onSuccess) onSuccess();
  } catch (error) {
    if (error.code === 'auth/popup-blocked' || error.code === 'auth/cancelled-popup-request') {
      localStorage.setItem(AUTH_PROVIDER_STORAGE_KEY, 'google');
      signInWithRedirect(auth, new GoogleAuthProvider());
    } else {
      if (!auth.currentUser) localStorage.removeItem(AUTH_PROVIDER_STORAGE_KEY);
      console.error('[Login Error]', error.code, error.message);
    }
  } finally {
    isLoginProcessing = false;
  }
};

export const kakaoLogin = async () => {
  if (isLoginProcessing) return;
  isLoginProcessing = true;

  localStorage.setItem(LOGIN_PENDING_PROVIDER_KEY, 'kakao');
  const scopeParam = localStorage.getItem(KAKAO_EMAIL_SCOPE_KEY) === '1' ? '&scope=account_email' : '';
  const kakaoAuthUrl = `https://kauth.kakao.com/oauth/authorize?response_type=code&client_id=${OAUTH_CLIENT_IDS.kakao}&redirect_uri=${encodeURIComponent(APP_BASE_URL)}${scopeParam}`;
  window.location.href = kakaoAuthUrl;
};

export const naverLogin = async () => {
  if (isLoginProcessing) return;
  isLoginProcessing = true;

  localStorage.setItem(LOGIN_PENDING_PROVIDER_KEY, 'naver');
  const state = Math.random().toString(36).slice(2, 13);
  const naverAuthUrl = `https://nid.naver.com/oauth2.0/authorize?response_type=code&client_id=${OAUTH_CLIENT_IDS.naver}&redirect_uri=${encodeURIComponent(APP_BASE_URL)}&state=${state}`;
  window.location.href = naverAuthUrl;
};

export const logoutUser = async (onSuccess) => {
  if (confirm("로그아웃 하시겠습니까? 게스트 모드로 전환됩니다.")) {
    try {
      localStorage.removeItem(AUTH_PROVIDER_STORAGE_KEY);
      await signOut(auth);
      const overlay = document.querySelector('.modal-overlay');
      if (overlay) overlay.remove();
      if (onSuccess) onSuccess();
    } catch (error) {
      console.error("로그아웃 중 오류 발생:", error);
    }
  }
};
