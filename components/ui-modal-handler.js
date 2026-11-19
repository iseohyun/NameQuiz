/**
 * @file components/ui-modal-handler.js
 * @description 모달 뷰(산리오 40종 & 티니핑 179종 도감/진도표, 캐릭터 상세 프로필 카드, 학습 통계 차트, 리더보드) UI 렌더링 모듈
 */

import { getAllProgress } from './db-handler.js';
import { INTERVALS } from './engine.js';
import { userConfig } from './store.js';
import { renderHintSection, openHintListModal } from './hint-handler.js';
import {
  TEENIEPING_SEASONS,
  getCharacters,
  getCharacterById,
  getCharacterProfileSpec,
  escapeHtml
} from './character-data.js';

let analysisMode = 'default';

/**
 * 학습현황 맨 위 「최대 콤보」 막대그래프와 역대 최대 콤보.
 * @param {Array<{key: string, label: string, value: number}>} entries 기간의 칸들(주·월은 날, 년은 달)
 * @param {{best: number, bestAt: string|null}} allTime 역대 최대 콤보(판·날짜가 바뀌어도 이어지는 연속 정답)
 */
export function renderComboChart(entries, allTime) {
  const container = document.getElementById('combo-chart');
  const bestEl = document.getElementById('combo-all-time');
  if (bestEl) {
    bestEl.textContent = allTime?.best
      ? `${allTime.best}콤보${allTime.bestAt ? ` · ${allTime.bestAt}` : ''}`
      : '아직 없음';
  }
  if (!container) return;

  const maxValue = Math.max(...entries.map((e) => e.value), 1);
  const dense = entries.length > 12;
  container.classList.toggle('dense', dense);
  container.innerHTML = entries.map((e, i) => {
    const height = (e.value / maxValue) * 100;
    // 한 달 보기는 칸이 많으므로 날짜 글씨를 5일마다만 쓴다
    const showLabel = !dense || i % 5 === 0 || i === entries.length - 1;
    return `
      <div class="combo-bar-col" title="${escapeHtml(e.key)}: ${e.value}콤보">
        <span class="combo-bar-value">${e.value && !dense ? e.value : ''}</span>
        <div class="combo-bar" style="height:${height}%;"></div>
        <span class="combo-bar-label">${showLabel ? escapeHtml(e.label) : ''}</span>
      </div>`;
  }).join('');
}

export async function renderResponseTimeChart(domain = 'sanrio', seasonFilter = 'all') {
  const container = document.getElementById('response-time-chart');
  if (!container) return;

  const allData = await getAllProgress(domain);
  const scopedChars = getCharacters(domain, seasonFilter);
  const scopedIdSet = new Set(scopedChars.map((c) => String(c.charId)));

  const correctBins = new Array(26).fill(0);
  let totalCount = 0;

  Object.entries(allData).forEach(([charKey, data]) => {
    if (!scopedIdSet.has(String(charKey)) || !data?.recentLatencies) return;
    data.recentLatencies.forEach((ms) => {
      const sec = ms / 1000;
      const binIndex = Math.min(Math.floor(sec / 0.2), 25);
      correctBins[binIndex]++;
      totalCount++;
    });
  });

  if (totalCount === 0) {
    container.innerHTML = `<div class="chart-empty-msg">분포 데이터 부족 (학습 후 표시됩니다)</div>`;
    return;
  }

  const maxFreq = Math.max(...correctBins, 1);
  const barHtml = correctBins.map((cVal, idx) => {
    const cHeight = (cVal / maxFreq) * 100;
    const isMaxBucket = cVal === maxFreq;
    const bgColor = isMaxBucket ? '#1e293b' : '#c084fc';
    return `<div title="${(idx * 0.2).toFixed(1)}s: ${cVal}회" style="flex:1; height:${cHeight}%; background:${bgColor}; min-width:1px;"></div>`;
  }).join('');

  const points = correctBins.map((v, i) => {
    const x = ((i + 0.5) / 26) * 100;
    const y = 100 - (v / maxFreq) * 100;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  container.innerHTML = barHtml + `
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="chart-Sparkline-svg">
      <polyline points="${points}" fill="none" stroke="#ec4899" stroke-width="1.3" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
    </svg>
  `;
}

function getLatencyColor(avgSec) {
  if (!avgSec || avgSec <= 0) return '#f8fafc';
  const ratio = Math.min(Math.max((avgSec - 1) / 4, 0), 1);
  const r = Math.floor(205 + (255 - 205) * ratio);
  const g = Math.floor(245 - (245 - 165) * ratio);
  const b = Math.floor(210 - (210 - 165) * ratio);
  return `rgb(${r}, ${g}, ${b})`;
}

export function getStageColor(stage) {
  if (!stage || stage <= 0) return '#f1f5f9';
  const colors = [
    '#ffdddd',
    '#ffe0cc',
    '#ffe6ba',
    '#fff0b3',
    '#edf2b2',
    '#d9efb0',
    '#c3e9ad',
    '#aedfaa',
    '#99d5a6'
  ];
  return colors[Math.min(stage, 8)];
}

/**
 * 캐릭터 상세 프로필 서브 모달 열기 (산리오: 생일/출생지/혈액형/출시연도, 티니핑: 시즌/등급/첫등장/마지막등장)
 */
export async function openCharacterDetailModal(charId, domain = 'sanrio') {
  const existing = document.querySelector('.char-detail-overlay');
  if (existing) existing.remove();

  const meta = getCharacterById(charId, domain);
  if (!meta) return;

  const profileSpec = getCharacterProfileSpec(meta);
  const domainProgress = await getAllProgress(domain);
  const progress = domainProgress[String(charId)] || domainProgress[charId] || null;
  const hasProgress = Boolean(progress && progress.stage > 0);
  const stage = hasProgress ? progress.stage : 0;
  const totalSolved = progress?.totalSolved || 0;
  const avgLatSec = (progress?.recentLatencies?.length > 0)
    ? (progress.recentLatencies.reduce((a, b) => a + b, 0) / progress.recentLatencies.length / 1000).toFixed(2)
    : '-';

  const profileGridHtml = profileSpec.fields.map((f) => `
    <div class="char-profile-item">
      <span class="char-profile-label">${escapeHtml(f.label)}</span>
      <strong class="char-profile-val">${escapeHtml(f.value)}</strong>
    </div>
  `).join('');

  const overlay = document.createElement('div');
  overlay.className = 'char-detail-overlay';
  overlay.innerHTML = `
    <div class="char-detail-card">
      <button type="button" class="char-detail-close" aria-label="닫기">&times;</button>

      <div class="char-detail-hero">
        <div class="char-detail-img-frame">
          <img src="${meta.imageUrl}" alt="${escapeHtml(meta.koName)}" />
        </div>
        <div class="char-detail-titles">
          <span class="char-detail-No">${escapeHtml(profileSpec.badgeNo)}</span>
          <h4 class="char-detail-ko">${escapeHtml(meta.koName)}</h4>
          <p class="char-detail-en">${escapeHtml(profileSpec.subtitle)}</p>
        </div>
      </div>

      <div class="char-profile-grid">${profileGridHtml}</div>

      <div class="char-hint-section" id="char-hint-section"></div>

      <div class="char-study-status-box">
        <div class="char-study-stat">
          <span>숙련도</span>
          <strong style="background:${getStageColor(stage)}; padding:2px 8px; border-radius:999px;">
            ${hasProgress ? `Lv.${stage}` : '미해금'}
          </strong>
        </div>
        <div class="char-study-stat">
          <span>평균 반응속도</span>
          <strong>${avgLatSec === '-' ? '-' : `${avgLatSec}초`}</strong>
        </div>
        <div class="char-study-stat">
          <span>누적 풀이</span>
          <strong>${totalSolved}회</strong>
        </div>
      </div>

      <div class="char-detail-actions">
        ${hasProgress
          ? `<button type="button" class="char-action-btn reset" id="btn-detail-reset">
               <span class="material-symbols-outlined" style="font-size:18px;">restart_alt</span>
               학습 기록 초기화
             </button>`
          : `<button type="button" class="char-action-btn unlock" id="btn-detail-unlock">
               <span class="material-symbols-outlined" style="font-size:18px;">lock_open</span>
               이 캐릭터 학습 해금하기
             </button>`
        }
      </div>
    </div>
  `;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('.char-detail-close')) {
      overlay.remove();
    }
  });

  document.body.appendChild(overlay);

  renderHintSection(overlay.querySelector('#char-hint-section'), domain, meta.koName);

  overlay.querySelector('#btn-detail-unlock')?.addEventListener('click', async () => {
    await window.activateSingleCharProgress?.(domain, charId);
    openCharacterDetailModal(charId, domain);
  });

  overlay.querySelector('#btn-detail-reset')?.addEventListener('click', async () => {
    if (confirm(`[${meta.koName}] 학습 기록을 초기화할까요?`)) {
      await window.resetSingleCharProgress?.(domain, charId);
      openCharacterDetailModal(charId, domain);
    }
  });
}

/**
 * 티니핑 시즌 필터 탭 렌더링 (산리오일 때는 숨김)
 */
export function renderSeasonTabsInModal(domain = 'sanrio', activeSeason = 'all', onSelectSeason = null) {
  const tabsWrap = document.getElementById('pokedex-season-tabs');
  if (!tabsWrap) return;

  if (domain !== 'teenieping') {
    tabsWrap.classList.add('hidden');
    tabsWrap.innerHTML = '';
    return;
  }

  tabsWrap.classList.remove('hidden');
  tabsWrap.innerHTML = TEENIEPING_SEASONS.map((s) => {
    const count = getCharacters('teenieping', s.id).length;
    const isActive = s.id === activeSeason;
    return `
      <button type="button" class="season-pill-btn ${isActive ? 'active' : ''}" data-season="${escapeHtml(s.id)}">
        ${escapeHtml(s.shortLabel)} <small>(${count})</small>
      </button>
    `;
  }).join('');

  if (onSelectSeason) {
    tabsWrap.querySelectorAll('.season-pill-btn').forEach((btn) => {
      btn.onclick = () => onSelectSeason(btn.dataset.season);
    });
  }
}

/**
 * 산리오(8열 그리드) 및 티니핑(7열 반응형 그리드) 도감 카드 목록 렌더링
 */
const LONG_PRESS_MS = 550;
const LONG_PRESS_MOVE_PX = 10;

/**
 * 길게 누르기. 손을 떼기 전에 LONG_PRESS_MS 가 지나면 onLongPress 를 부르고,
 * 뒤따르는 click 은 el.dataset.longPressed 로 한 번 무시하게 한다.
 */
function bindLongPress(el, onLongPress) {
  let timer = null;
  let startX = 0;
  let startY = 0;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  el.addEventListener('pointerdown', (e) => {
    startX = e.clientX;
    startY = e.clientY;
    el.dataset.longPressed = '';
    cancel();
    timer = setTimeout(() => {
      timer = null;
      el.dataset.longPressed = '1';
      onLongPress();
    }, LONG_PRESS_MS);
  });
  el.addEventListener('pointermove', (e) => {
    if (Math.abs(e.clientX - startX) > LONG_PRESS_MOVE_PX || Math.abs(e.clientY - startY) > LONG_PRESS_MOVE_PX) cancel();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => el.addEventListener(type, cancel));
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

export function renderProgressTable(domain = 'sanrio', domainProgress = {}, seasonFilter = 'all') {
  const gridContainer = document.getElementById('progress-grid');
  const countLabel = document.getElementById('settings-active-count');
  if (!gridContainer) return;

  gridContainer.innerHTML = '';
  gridContainer.className = `pokedex-grid ${domain === 'teenieping' ? 'teenieping-grid' : 'sanrio-grid'}`;

  const safeProgress = domainProgress || {};
  const scopedCharacters = getCharacters(domain, seasonFilter);

  const totalCount = scopedCharacters.length;
  let learnedCount = 0;

  scopedCharacters.forEach((meta) => {
    const progress = safeProgress[meta.charId.toString()] || safeProgress[meta.charId];
    const hasProgress = Boolean(progress && progress.stage > 0);
    if (hasProgress) learnedCount++;

    let isOverdue = false;
    if (hasProgress) {
      const lastTime = progress.lastSessionTime || Date.now();
      const timeDiffMin = (Date.now() - lastTime) / (60 * 1000);
      const requiredMin = INTERVALS[progress.stage] || INTERVALS[INTERVALS.length - 1];
      isOverdue = timeDiffMin >= requiredMin;
    }

    const shortName = (domain === 'sanrio' && userConfig.nameLang === 'en')
      ? meta.enName.split(' ')[0]
      : meta.koName.replace(/\(.*\)/, '').trim();

    const card = document.createElement('div');
    card.className = 'pokedex-cell';

    const seasonTag = (domain === 'teenieping' && seasonFilter === 'all' && meta.season)
      ? `<span class="pokedex-season-chip">${escapeHtml(meta.season)}</span>`
      : '';

    if (!hasProgress) {
      card.classList.add('locked');
      card.innerHTML = `
        ${seasonTag}
        <img src="${meta.imageUrl}" alt="${escapeHtml(meta.koName)}" class="pokedex-thumb" loading="lazy" />
        <div class="pokedex-name">${escapeHtml(shortName)}</div>
        <div class="pokedex-stat">-</div>
      `;
    } else {
      const avgLat = progress.recentLatencies?.length > 0
        ? (progress.recentLatencies.reduce((a, b) => a + b, 0) / progress.recentLatencies.length / 1000)
        : 0;
      const infoText = analysisMode === 'stage'
        ? `Lv.${progress.stage}`
        : (avgLat ? `${avgLat.toFixed(1)}s` : '-');

      card.style.background = analysisMode === 'stage' ? getStageColor(progress.stage) : getLatencyColor(avgLat);
      if (isOverdue) card.classList.add('overdue');

      card.innerHTML = `
        ${seasonTag}
        <img src="${meta.imageUrl}" alt="${escapeHtml(meta.koName)}" class="pokedex-thumb" loading="lazy" />
        <div class="pokedex-name">${escapeHtml(shortName)}</div>
        <div class="pokedex-stat">${escapeHtml(infoText)}</div>
      `;
    }

    card.title = `${meta.koName}${meta.season ? ` (${meta.season})` : ''} — 클릭하여 상세 프로필 및 해금/초기화`;
    // 짧게 누르면 상세 프로필, 길게 누르면 그 캐릭터의 힌트 목록 (QuizApp Common GUI 「학습현황」)
    bindLongPress(card, () => openHintListModal(domain, meta.koName));
    card.onclick = () => {
      if (card.dataset.longPressed === '1') {
        card.dataset.longPressed = '';
        return;
      }
      openCharacterDetailModal(meta.charId, domain);
    };
    gridContainer.appendChild(card);
  });

  if (countLabel) {
    const percent = totalCount > 0 ? ((learnedCount / totalCount) * 100).toFixed(1) : '0.0';
    countLabel.innerText = `${learnedCount} / ${totalCount} (${percent}%)`;
  }
}

export async function toggleAnalysisMode() {
  analysisMode = analysisMode === 'default' ? 'stage' : 'default';
  const btn = document.getElementById('btn-analysis');
  if (btn) btn.innerText = analysisMode === 'stage' ? '장기기억' : '응답속도';

  const domain = userConfig.currentDomain;
  const seasonFilter = domain === 'teenieping' ? (userConfig.teeniepingSeason || 'all') : 'all';
  const currentDomainData = await getAllProgress(domain);
  renderProgressTable(domain, currentDomainData, seasonFilter);
}

function formatLeaderboardDomainLabel(rawDomain = '') {
  if (!rawDomain) return '';
  return rawDomain
    .replace(/^sanrio/, '산리오')
    .replace(/^teenieping-/, '티니핑 ')
    .replace(/^teenieping/, '티니핑')
    .replace('(혼합)', ' · 교차')
    .replace('(그림→이름)', ' · 그림')
    .replace('(이름→그림)', ' · 이름')
    .replace('(질문)', ' · 질문');
}

/**
 * 질문(Trivia) 모드 세트 완료 시 점수·정답률·문항별 해설 리포트 모달을 표시한다.
 * @param {{
 *   totalCount: number,
 *   correctCount: number,
 *   elapsedSeconds: number,
 *   logs: Array<{ promptText: string, explanation: string, targetMeta: object, selectedMeta: object, isCorrect: boolean }>,
 *   onRetry?: () => void
 * }} report
 */
export function openTriviaReportModal(report) {
  document.querySelector('.modal-overlay')?.remove();

  const { totalCount, correctCount, elapsedSeconds, logs = [], onRetry } = report;
  const accuracy = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;
  const minStr = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
  const secStr = String(elapsedSeconds % 60).padStart(2, '0');

  const itemsHtml = logs.map((entry, idx) => {
    const statusClass = entry.isCorrect ? 'correct' : 'wrong';
    const badgeLabel = entry.isCorrect ? '⭕ 정답' : '❌ 오답';
    const targetName = entry.targetMeta?.koName || '';
    const selectedName = entry.selectedMeta?.koName || '';
    const wrongNote = (!entry.isCorrect && selectedName)
      ? `<span class="trivia-report-mypick">내 선택: ${escapeHtml(selectedName)}</span>`
      : '';

    return `
      <div class="trivia-report-item ${statusClass}">
        <div class="trivia-report-q-head">
          <span class="trivia-report-q-badge ${statusClass}">${badgeLabel}</span>
          <strong class="trivia-report-q-text">Q${idx + 1}. ${escapeHtml(entry.promptText)}</strong>
        </div>
        <div class="trivia-report-ans-row">
          ${entry.targetMeta?.imageUrl ? `<img src="${entry.targetMeta.imageUrl}" alt="${escapeHtml(targetName)}" class="trivia-report-thumb" />` : ''}
          <div class="trivia-report-ans-meta">
            <div class="trivia-report-names">
              <span class="trivia-report-correct-name">정답: ${escapeHtml(targetName)}</span>
              ${wrongNote}
            </div>
            <p class="trivia-report-exp">💡 ${escapeHtml(entry.explanation || '')}</p>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3 class="modal-title">🎯 질문 퀴즈 결과 리포트</h3>
        <div class="modal-header-actions">
          <button type="button" class="modal-close" aria-label="닫기">&times;</button>
        </div>
      </div>
      <div class="modal-body">
        <div class="trivia-summary-banner">
          <div class="trivia-summary-stat">
            <span>점수</span>
            <strong>${correctCount} / ${totalCount}</strong>
          </div>
          <div class="trivia-summary-stat">
            <span>정답률</span>
            <strong class="accent">${accuracy}%</strong>
          </div>
          <div class="trivia-summary-stat">
            <span>소요 시간</span>
            <strong>${minStr}:${secStr}</strong>
          </div>
        </div>

        <div class="trivia-report-list">${itemsHtml}</div>

        <div class="trivia-report-footer">
          <button type="button" class="trivia-footer-btn retry" id="btn-trivia-retry">
            <span class="material-symbols-outlined" style="font-size:18px;">replay</span>
            다시 풀기
          </button>
          <button type="button" class="trivia-footer-btn home" id="btn-trivia-close">
            <span class="material-symbols-outlined" style="font-size:18px;">check_circle</span>
            확인
          </button>
        </div>
      </div>
    </div>
  `;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('.modal-close') || e.target.closest('#btn-trivia-close')) {
      overlay.remove();
    }
  });

  overlay.querySelector('#btn-trivia-retry')?.addEventListener('click', () => {
    overlay.remove();
    onRetry?.();
  });

  document.body.appendChild(overlay);
}

export function renderLeaderboardUI(rankings, mode = 'speedrun') {
  const listContainer = document.getElementById('leaderboard-list');
  if (!listContainer) return;

  ['speedrun', 'timeattack', 'hints'].forEach((tabMode) => {
    document.getElementById(`tab-${tabMode}`)?.classList.toggle('active', tabMode === mode);
  });

  const headerContainer = document.getElementById('leaderboard-header');
  if (headerContainer) {
    headerContainer.innerHTML = mode === 'timeattack'
      ? `<tr>
           <th>순위</th>
           <th>아이디</th>
           <th>도메인 / 유형</th>
           <th>맞힘 (푼 수)</th>
           <th>정답률</th>
           <th>완료 시각</th>
         </tr>`
      : `<tr>
           <th>순위</th>
           <th>아이디</th>
           <th>도메인 / 유형</th>
           <th>소요시간</th>
           <th>정답률</th>
           <th>완료 시각</th>
         </tr>`;
  }

  listContainer.innerHTML = '';
  const colCount = 6;

  if (!rankings || rankings.length === 0) {
    listContainer.innerHTML = `<tr><td colspan="${colCount}" class="leaderboard-empty">등록된 기록이 없습니다. 첫 번째 주인공이 되어 보세요!</td></tr>`;
    return;
  }

  listContainer.innerHTML = rankings.map((entry, index) => {
    const rank = index + 1;
    const rankClass = rank <= 3 ? 'rank-top' : 'rank-normal';

    let displayName = entry.name || '게스트';
    if (displayName.startsWith('GUEST_')) {
      displayName = 'G_' + displayName.substring(6, 10) + '...';
    }

    const safeName = escapeHtml(displayName);
    const domainDisplay = escapeHtml(formatLeaderboardDomainLabel(entry.domain));
    const safeElapsed = escapeHtml(entry.elapsedStr || '-');
    const safeUpdatedAt = escapeHtml(entry.updatedAt || '');
    const highlightClass = (window.highlightRecordId && window.highlightRecordId === entry.id) ? 'highlight-row' : '';

    if (mode === 'timeattack') {
      return `
        <tr class="${highlightClass}">
          <td class="${rankClass}">${rank}</td>
          <td class="lb-name">${safeName}</td>
          <td>${domainDisplay}</td>
          <td class="lb-correct">${Number(entry.correctCount) || 0} <small>(${Number(entry.solvedCount) || 0})</small></td>
          <td>${Number(entry.accuracy) || 0}%</td>
          <td class="lb-date">${safeUpdatedAt}</td>
        </tr>
      `;
    }

    return `
      <tr class="${highlightClass}">
        <td class="${rankClass}">${rank}</td>
        <td class="lb-name">${safeName}</td>
        <td>${domainDisplay} <span class="lb-count">(${Number(entry.charCount) || 0})</span></td>
        <td class="lb-time">${safeElapsed}</td>
        <td>${Number(entry.accuracy) || 0}%</td>
        <td class="lb-date">${safeUpdatedAt}</td>
      </tr>
    `;
  }).join('');
}
