# QuizApp Common GUI 동기화 기록

- 확인한 판: v0.2.0 (2026-11-19)
- 앱의 표시: `index.html`의 `window.QUIZAPP_GUI_VERSION = "v0.2.0"`(도움말 맨 아래에 보임)

| 항목 ID | 판 | 결정 | 날짜 | 메모 |
| :--- | :--- | :--- | :--- | :--- |
| quiz-base | v0.1.0 | 적용 | 2026-11-19 | 전체 화면 설정·리더보드·학습현황·도움말과 설정 도구 줄(알림함·도움말·공유·설치), 톱니 new 점(헤더 종은 뺌), 학습 결과표, 30초 타임어택(질문 방식이면 교차로 냄), 도감 캐릭터 길게 누르기로 힌트. 그림 문제·질문 퀴즈·상세 프로필·기록 뒤 리더보드 강조는 NameQuiz 고유로 유지. 설정의 접는 묶음은 아직 아님 |
| firebase-shared | v0.1.0 | 적용 | 2026-11-19 | quizquiz-quiz, namequiz_* 순위 |
| legacy-users | v0.1.0 | 적용 | 2026-11-19 | |
| season-stage | v0.2.0 | 적용 | 2026-11-19 | 계절 무대는 NameQuiz 고유의 캐릭터 무대 그대로, 그 위에 날씨 층(components/weather-layer.js)과 「날씨 반영」 설정 |
| guest-ranking | v0.2.0 | 적용 | 2026-11-19 | 학습 결과표·30초 결과 창 아래 로그인 안내 |
| accent-color | v0.2.0 | 적용 | 2026-11-19 | 토큰에 --accent-strong, --accent-softer 를 더 둠(NameQuiz 의 분홍 단계가 많아서) |
| combo-record | v0.2.0 | 적용 | 2026-11-19 | namequizCombo, namequizMaxCombo |
| review-always | v0.2.0 | 적용 | 2026-11-19 | 티니핑 시즌 필터를 범위로 보고 다른 시즌의 복습 캐릭터도 냄, 복습 배지는 도메인 전체 |
| notify-throttle | v0.2.0 | 적용 | 2026-11-19 | 서버 함수(QuizQuiz)라 앱은 할 일 없음 |
| combo | v0.2.0 | 적용 | 2026-11-19 | |
| install-sister | v0.2.0 | 적용 | 2026-11-19 | 자매품 링크는 사용자 요청으로 알림함이 아니라 도움말 맨 위(quiz_apps DB) |
| help-version | v0.2.0 | 적용 | 2026-11-19 | |
| system-bar-white | v0.2.0 | 적용 | 2026-11-19 | |
