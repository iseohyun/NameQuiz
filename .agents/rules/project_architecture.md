# Project Architecture Rules (NameQuiz)

## 1. CSS 스타일링 아키텍처
- **단일 중앙 집중형 CSS (`common.css`)**:
  - 애플리케이션의 모든 레이아웃, 디자인 토큰(`:root`), 모드 선택 카드, 게임 화면(학습/기록/관전 모드), 도감 그리드(산리오 40종 / 티니핑 179종), 캐릭터 상세 프로필 모달 스타일은 루트의 `common.css`에서 중앙 집중형으로 관리한다.
  - `view/*.html` 조각 파일 내부에 `common.css`와 충돌하거나 분산되는 인라인 `<style>` 태그 사용을 지양한다.

## 2. 이원화 버전 관리 및 캐시 버스팅 (Cache-Busting)
- **정식 시맨틱 버전 (`window.APP_VERSION`)**: 사용자 승인 시 갱신되는 정식 릴리즈 버전 태그 (초기값 `v1.0.0`).
- **일자 기반 캐시 버스팅 태그 (`window.CACHE_BUST`)**: 코드/스타일 수정 시 `YYYYMMDDvN` 포맷(예: `20261117v3`)으로 자동 갱신하여 `common.css`, `main.js`, `components/*.js`, `view/*.html`, `characters/*.cvs` 원격 fetch 시 브라우저 강제 새로고침 없이도 최신 리소스가 즉시 반영되도록 유지한다.
- **ES 모듈 캐시 버스팅 (import map)**: `index.html`의 `componentModules` 목록에 있는 모듈만 `?v=CACHE_BUST`로 로드된다.
  - `components/`에 모듈을 **추가·삭제·이름 변경하면 반드시 이 목록도 함께 수정**한다.

## 3. 배포 위치 및 외부 연동 설정
- **원격 저장소 및 서비스 위치**: `https://github.com/iseohyun/NameQuiz.git` → GitHub Pages 프로젝트 사이트 `https://iseohyun.com/NameQuiz/` (로컬: `http://127.0.0.1:5500/`).
- **경로·도메인을 코드에 하드코딩하지 않는다.** 배포 위치에 따라 달라지는 값은 `components/app-config.js`의 `APP_BASE_URL`(런타임 계산)을 사용한다.
- **외부 연동 상수**(Cloud Run OAuth 엔드포인트, OAuth 클라이언트 ID)는 `components/app-config.js` 한곳에서 관리하며, Firebase 설정은 `components/firebase-config.js`에서 관리한다.
- 오디오/음성 합성 및 웹 푸시 알림 모듈은 사용하지 않는다.

## 4. 멀티 도메인(산리오 · 티니핑) 및 데이터 격리 규칙
- 지원 도메인: `sanrio` (산리오 40종), `teenieping` (캐치! 티니핑 179종, 전체 및 `1기`~`7기`·`극장판` 시즌 필터 지원).
- 동일 이름 캐릭터(예: 시즌별 `하츄핑`, `트러핑` 등) 출제 시 4지선다 보기에 동일 기본 이름이 중복 등장하지 않도록 `engine.js`에서 기본 이름(`koName`) 기준 중복 배제를 강제한다.
- `localStorage` 키 접두어는 `NAMEQUIZ_`를 사용하여 동일 출처(Origin)에서 구동되는 `CharQuiz`와 데이터가 충돌하지 않도록 격리한다.
- 날짜 키는 `components/date-utils.js`의 `toLocalDateKey()`(로컬 날짜 기준)를 사용한다.
- Firestore 퀴즈 앱 공용 프로젝트(`quizquiz-quiz`, 규칙·함수는 `C:\git\QuizQuiz`) 저장 시:
  - 순위는 `namequiz_speedrun_rankings`(20문제)·`namequiz_timeattack_rankings`(30초)에 사람·도메인마다 문서 하나(`uid_domain`, 최고 기록), 힌트는 `name_hints`·`name_hint_likes` 컬렉션을 쓴다.
  - 사용자 환경설정은 `users/{uid}` 문서의 `namequizConfig` 필드에 저장한다.
  - 캐릭터 진도는 `users/{uid}/progress/{domain}/chars/{charId}` 경로에 마스터 `charId` 기준으로 저장하여 시즌 필터 전환 시에도 학습 진도가 일관되게 공유되도록 유지한다.
