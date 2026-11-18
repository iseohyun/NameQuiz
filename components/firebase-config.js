/**
 * @file components/firebase-config.js
 * @description Firebase App, Auth, Firestore, Cloud Messaging 인스턴스 초기화 모듈
 *
 * appId 는 CharQuiz 와 다른 「NameQuiz」 웹 앱의 것을 쓴다. 두 앱은 같은 도메인에 있어서, appId 가 같으면
 * Firebase 메시징이 토큰 저장소를 함께 쓰다가 서로의 알림 토큰을 지운다.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { getMessaging } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyAm1BiqPabnh0X-FLxctRUAoRWbd9OrdlI",
  authDomain: "kana-loop.firebaseapp.com",
  projectId: "kana-loop",
  storageBucket: "kana-loop.firebasestorage.app",
  messagingSenderId: "566732000404",
  appId: "1:566732000404:web:213177f4c7f6035ebd3881",
  measurementId: "G-SMS2R6V76L"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// 웹 푸시를 지원하지 않는 브라우저(아이폰의 Safari 탭 등)에서도 앱 전체가 멈추지 않도록 실패하면 null 로 둔다
export let messaging = null;
try {
  messaging = getMessaging(app);
} catch (error) {
  console.warn('[Notify] 이 브라우저는 웹 푸시를 지원하지 않습니다:', error?.code || error);
}
