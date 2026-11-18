/**
 * @file components/app-config.js
 * @description 배포 위치에 따라 달라지는 기준 URL(APP_BASE_URL)과 외부 OAuth 연동 상수를 중앙 관리하는 모듈.
 * 참고: 아래 식별자는 모두 브라우저 공개용 클라이언트 ID 및 Cloud Run 엔드포인트이며 비밀키가 아닙니다.
 */

/**
 * 현재 페이지가 서비스되는 디렉터리의 절대 URL (쿼리스트링/해시 제외, 끝에 '/' 포함).
 */
export const APP_BASE_URL = new URL('./', window.location.href).href;

/** Cloud Run(Cloud Functions 2세대) OAuth 토큰 교환 엔드포인트 */
export const ENDPOINTS = Object.freeze({
  naverLogin: 'https://naverlogin-kw55rtsoba-uc.a.run.app',
  kakaoLogin: 'https://kakaologin-kw55rtsoba-uc.a.run.app',
  scheduleNotification: 'https://schedulenotification-kw55rtsoba-uc.a.run.app'
});

/** 소셜 로그인 OAuth 클라이언트 ID (Kakao: REST API 키, Naver: Client ID) */
export const OAUTH_CLIENT_IDS = Object.freeze({
  kakao: 'af28f94aa8260ab663fd27dffea1ee77',
  naver: 'hemXaBshyStfBhmNg05m'
});

/** Firebase Cloud Messaging 웹 푸시 VAPID 공개키 (CharQuiz 와 같은 프로젝트의 키) */
export const FCM_VAPID_KEY = 'BCsz-FURaLXuyEgWJ5opmzZ2bk8oBACk7pGXouwVF71PlrK-XA-z95QuGNBPqHCi9ppaUD66UGQ79bf2ozcqjpg';
