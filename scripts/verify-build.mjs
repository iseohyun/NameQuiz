/**
 * @file scripts/verify-build.mjs
 * @description NameQuiz 정적 웹앱 빌드/무결성 사전 검증 스크립트 (npm.cmd run build).
 * 1) 모든 JS 모듈(main.js, components/*.js) 구문 오류(node --check) 0건 확인
 * 2) index.html importmap 모듈 목록과 components/ 파일 1:1 일치 확인
 * 3) view/*.html 조각 파일 존재 및 인라인 <style> 미사용 아키텍처 규칙 준수 확인
 * 4) 산리오(40종) 및 캐치! 티니핑(179종) CSV 및 개별 이미지 파일 전수 확인
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

let errorCount = 0;
function fail(msg) {
  console.error(`❌ [VERIFY FAIL] ${msg}`);
  errorCount++;
}

// 1. 필수 루트 파일 확인
for (const reqFile of ['index.html', 'common.css', 'main.js', 'favicon.svg', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'characters/sanrio.cvs', 'characters/Teenieping.cvs']) {
  const full = path.join(rootDir, reqFile);
  if (!fs.existsSync(full)) {
    fail(`필수 파일 누락: ${reqFile}`);
  }
}

// 2. JS 구문 검증 (node --check)
const compDir = path.join(rootDir, 'components');
const compFiles = fs.existsSync(compDir)
  ? fs.readdirSync(compDir).filter((f) => f.endsWith('.js')).sort()
  : [];

const jsTargets = [path.join(rootDir, 'main.js'), ...compFiles.map((f) => path.join(compDir, f))];
for (const jsFile of jsTargets) {
  try {
    execFileSync(process.execPath, ['--check', jsFile], { stdio: 'pipe' });
  } catch (err) {
    fail(`JS 구문 오류 (${path.relative(rootDir, jsFile)}): ${err.stderr?.toString() || err.message}`);
  }
}

// 3. index.html importmap 동기화 확인
const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
const match = indexHtml.match(/const\s+componentModules\s*=\s*\[([\s\S]*?)\]/);
if (!match) {
  fail('index.html에서 componentModules 배열을 찾을 수 없습니다.');
} else {
  const listed = [...match[1].matchAll(/["']([^"']+)["']/g)].map((m) => `${m[1]}.js`).sort();
  if (JSON.stringify(listed) !== JSON.stringify(compFiles)) {
    fail(`index.html componentModules 불일치!\n  listed: ${listed.join(', ')}\n  actual: ${compFiles.join(', ')}`);
  }
}

// 4. view/*.html 확인 및 단일 중앙 집중형 CSS 준수(<style> 금지) 검증
const expectedViews = ['help.html', 'leaderboard.html', 'login.html', 'progress.html', 'setting.html', 'spectatorMode.html', 'studyMode.html'];
for (const v of expectedViews) {
  const vp = path.join(rootDir, 'view', v);
  if (!fs.existsSync(vp)) {
    fail(`뷰 파일 누락: view/${v}`);
    continue;
  }
  const content = fs.readFileSync(vp, 'utf8');
  if (/<style[\s>]/i.test(content)) {
    fail(`아키텍처 규칙 위반: view/${v} 내부에 인라인 <style> 태그가 존재합니다 (common.css로 통합 필요).`);
  }
}

// 5. 산리오 캐릭터 CSV 40행 및 크롭 이미지 40장 확인
const sanrioLines = fs.readFileSync(path.join(rootDir, 'characters', 'sanrio.cvs'), 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.trim().length > 0);
if (sanrioLines.length !== 41) {
  fail(`sanrio.cvs 행 개수 오류: 헤더 포함 41줄이어야 하나 ${sanrioLines.length}줄입니다.`);
}
for (let i = 1; i <= 40; i++) {
  const imgName = `${String(i).padStart(2, '0')}.png`;
  if (!fs.existsSync(path.join(rootDir, 'characters', 'cropped', imgName))) {
    fail(`산리오 크롭 이미지 누락: characters/cropped/${imgName}`);
  }
}

// 6. 티니핑 캐릭터 CSV 179행 및 개별 이미지 179장 확인
const tpLines = fs.readFileSync(path.join(rootDir, 'characters', 'Teenieping.cvs'), 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.trim().length > 0);
if (tpLines.length !== 180) {
  fail(`Teenieping.cvs 행 개수 오류: 헤더 포함 180줄이어야 하나 ${tpLines.length}줄입니다.`);
}
for (let i = 1; i < tpLines.length; i++) {
  const cols = tpLines[i].split('\t');
  const relImg = (cols[9] || '').trim();
  if (!relImg || !fs.existsSync(path.join(rootDir, 'characters', relImg))) {
    fail(`티니핑 개별 이미지 누락 (${i}행): characters/${relImg}`);
  }
}

if (errorCount > 0) {
  console.error(`\n🚨 빌드 검증 실패: 총 ${errorCount}건의 오류가 발견되었습니다.`);
  process.exit(1);
} else {
  console.log(`✅ [NameQuiz Build Verified] JS 모듈 ${jsTargets.length}개 구문 정상, importmap 일치, 뷰 ${expectedViews.length}개 정상, 산리오 40종 + 티니핑 179종(총 219종) 검증 완료!`);
}
