/**
 * @file components/seasonal-stage.js
 * @description 첫 화면 안내 카드(.mode-info-card)의 사계절(봄·여름·가을·겨울) 배경 스크롤,
 * 캐릭터 S자 슬라럼 유영(최대 10개), 발밑 이동 흔적(스키 마크·물보라·발자국·꽃보라) 및 낙하 파티클(눈송이·윤슬·낙엽·벚꽃잎) 연출 모듈.
 */

export const SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'];

export const SEASON_META = Object.freeze({
  spring: { id: 'spring', icon: '🌸', label: '봄 · 벚꽃 풀밭' },
  summer: { id: 'summer', icon: '🌊', label: '여름 · 윤슬 물장구' },
  autumn: { id: 'autumn', icon: '🍂', label: '가을 · 단풍 산책길' },
  winter: { id: 'winter', icon: '❄️', label: '겨울 · 설원 스키장' }
});

const MAX_FLOATING_CHARS = 10;
const GROUND_SCROLL_SPEED = 54; // px/s (배경이 아래->위로 올라가는 속도)

/**
 * 현재 로컬 날짜 기준 기본 계절 테마를 반환한다. (3~5월 봄, 6~8월 여름, 9~11월 가을, 12~2월 겨울)
 * @param {Date} [date=new Date()]
 * @returns {'spring'|'summer'|'autumn'|'winter'}
 */
export function getDefaultSeasonByDate(date = new Date()) {
  const month = date.getMonth() + 1;
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

// 현재 세션에서 활성화된 테마 (초기값은 오늘 날짜 기준, 더블클릭 시 순환)
let currentSeasonTheme = getDefaultSeasonByDate();

export function getActiveSeasonTheme() {
  return currentSeasonTheme;
}

export function cycleSeasonTheme() {
  const idx = SEASON_ORDER.indexOf(currentSeasonTheme);
  currentSeasonTheme = SEASON_ORDER[(idx + 1) % SEASON_ORDER.length];
  return currentSeasonTheme;
}

export function setSeasonTheme(theme) {
  if (SEASON_ORDER.includes(theme)) {
    currentSeasonTheme = theme;
  }
  return currentSeasonTheme;
}

// 내부 애니메이션 루프 상태
let rafId = null;
let spawnTimerId = null;
let lastFrameTs = 0;
let stageWidth = 280;
let stageHeight = 260;

let activeSprites = [];
let groundProps = [];    // 바닥과 함께 위로 올라가는 지형 오브젝트(눈덩이, 윤슬, 바닥 낙엽, 풀꽃)
let trailEffects = [];   // 캐릭터가 지나간 자리에 남는 흔적(스키 트랙, 물보라, 발자국, 꽃송이)
let skyParticles = [];   // 하늘에서 내리는 환경 효과(눈송이, 반짝이, 낙엽, 벚꽃잎)

export function stopSeasonalStage() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (spawnTimerId) {
    clearInterval(spawnTimerId);
    spawnTimerId = null;
  }
  activeSprites = [];
  groundProps = [];
  trailEffects = [];
  skyParticles = [];
  lastFrameTs = 0;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 위로 끝없이 올라가는 바닥 장식 요소 초기화
 */
function initGroundProps(theme, w, h) {
  groundProps = [];
  const count = theme === 'summer' ? 28 : 34;
  for (let i = 0; i < count; i++) {
    groundProps.push(makeGroundProp(theme, w, rand(0, h)));
  }
}

function makeGroundProp(theme, w, yPos) {
  if (theme === 'winter') {
    return {
      x: rand(8, w - 8),
      y: yPos,
      r: rand(2.5, 6.5),
      kind: Math.random() < 0.35 ? 'mound' : 'snowball',
      alpha: rand(0.45, 0.9)
    };
  }
  if (theme === 'summer') {
    return {
      x: rand(10, w - 10),
      y: yPos,
      r: rand(10, 26),
      phase: rand(0, Math.PI * 2),
      speed: rand(2.2, 4.0),
      kind: Math.random() < 0.4 ? 'sparkle' : 'wave'
    };
  }
  if (theme === 'autumn') {
    const colors = ['#ea580c', '#dc2626', '#d97706', '#eab308', '#b45309'];
    return {
      x: rand(8, w - 8),
      y: yPos,
      r: rand(3.5, 6.5),
      rot: rand(0, Math.PI * 2),
      color: pickRandom(colors),
      kind: Math.random() < 0.5 ? 'maple' : 'ginkgo',
      alpha: rand(0.55, 0.9)
    };
  }
  // spring
  const flowerColors = ['#f472b6', '#fb7185', '#facc15', '#ffffff'];
  return {
    x: rand(8, w - 8),
    y: yPos,
    r: rand(3.0, 5.5),
    color: pickRandom(flowerColors),
    kind: Math.random() < 0.45 ? 'dandelion' : 'grass',
    alpha: rand(0.55, 0.9)
  };
}

/**
 * 하늘에서 떨어지거나 반짝이는 전경 파티클 초기화
 */
function initSkyParticles(theme, w, h) {
  skyParticles = [];
  const count = theme === 'winter' ? 26 : (theme === 'autumn' ? 11 : (theme === 'spring' ? 18 : 16));
  for (let i = 0; i < count; i++) {
    skyParticles.push(makeSkyParticle(theme, w, h, true));
  }
}

function makeSkyParticle(theme, w, h, randomY = false) {
  if (theme === 'winter') {
    return {
      x: rand(0, w),
      y: randomY ? rand(0, h) : rand(-18, -4),
      r: rand(2.0, 4.6),
      vx: rand(-10, 10),
      vy: rand(24, 48),
      swayAmp: rand(6, 14),
      swayFreq: rand(1.2, 2.5),
      age: rand(0, 10),
      alpha: rand(0.65, 0.96)
    };
  }
  if (theme === 'summer') {
    // 물빛 윤슬 반짝이
    return {
      x: rand(8, w - 8),
      y: randomY ? rand(8, h - 8) : rand(8, h - 8),
      r: rand(2.2, 4.8),
      vx: 0,
      vy: -GROUND_SCROLL_SPEED * 0.65,
      age: rand(0, Math.PI * 2),
      swayFreq: rand(2.8, 5.0),
      alpha: 0.85
    };
  }
  if (theme === 'autumn') {
    const colors = ['#ef4444', '#f97316', '#eab308', '#dc2626'];
    return {
      x: rand(0, w),
      y: randomY ? rand(0, h) : rand(-20, -5),
      r: rand(4.8, 7.5),
      vx: rand(-12, 14),
      vy: rand(18, 34),
      swayAmp: rand(12, 22),
      swayFreq: rand(1.4, 2.4),
      rot: rand(0, Math.PI * 2),
      rotSpeed: rand(-2.2, 2.2),
      color: pickRandom(colors),
      age: rand(0, 10),
      alpha: rand(0.8, 0.98)
    };
  }
  // spring: 흩날리는 벚꽃잎
  return {
    x: rand(-10, w + 10),
    y: randomY ? rand(0, h) : rand(-16, -4),
    r: rand(3.8, 6.2),
    vx: rand(8, 22),
    vy: rand(18, 34),
    swayAmp: rand(8, 16),
    swayFreq: rand(1.6, 2.8),
    rot: rand(0, Math.PI * 2),
    rotSpeed: rand(-2.5, 2.5),
    color: Math.random() < 0.7 ? '#fbcfe8' : '#f9a8d4',
    age: rand(0, 10),
    alpha: rand(0.78, 0.96)
  };
}

/**
 * 슬라럼 유영 캐릭터 1개 생성 (최대 10개 유지)
 * 배경이 위로 스크롤되므로, 상단·좌상단·우상단·측면에서 완만히 내려오며 S자 커브를 그리면
 * 설원을 미끄러져 내려오거나 물장구치며 전진하는 자연스러운 착시가 완성된다.
 */
function spawnCharacterSprite(spriteLayer, charsPool, enterInside = false) {
  if (!spriteLayer || !charsPool || charsPool.length === 0) return;
  if (activeSprites.length >= MAX_FLOATING_CHARS) return;

  const activeIds = new Set(activeSprites.map((s) => s.charId));
  let candidates = charsPool.filter((c) => !activeIds.has(c.charId));
  if (candidates.length === 0) candidates = charsPool;
  const chosen = pickRandom(candidates);

  const size = Math.round(rand(42, 56));
  const entryRoll = Math.random();

  let x = 0;
  let y = 0;
  let baseVx = 0;
  const vy = rand(14, 28); // 화면 아래쪽으로 완만히 전진 (배경은 위로 54px/s 이동 -> 상대속도 약 75px/s 하강!)

  if (entryRoll < 0.52) {
    // 상단 진입
    x = rand(12, Math.max(20, stageWidth - size - 12));
    y = -size + 4;
    baseVx = rand(-18, 18);
  } else if (entryRoll < 0.76) {
    // 좌측 사선 진입
    x = -size + 4;
    y = rand(-10, stageHeight * 0.55);
    baseVx = rand(18, 34);
  } else {
    // 우측 사선 진입
    x = stageWidth - 4;
    y = rand(-10, stageHeight * 0.55);
    baseVx = rand(-34, -18);
  }

  if (enterInside) {
    y = rand(8, stageHeight * 0.72);
    x = rand(10, Math.max(20, stageWidth - size - 10));
  }

  const img = document.createElement('img');
  img.src = chosen.imageUrl;
  img.alt = '';
  img.className = 'floating-char-sprite';
  img.style.width = `${size}px`;
  img.style.height = `${size}px`;
  spriteLayer.appendChild(img);

  const footX = x + size * 0.5;
  const footY = y + size * 0.82;

  activeSprites.push({
    charId: chosen.charId,
    el: img,
    size,
    x,
    y,
    baseVx,
    vy,
    slalomAmp: rand(16, 32),
    slalomFreq: rand(1.3, 2.3),
    age: rand(0, Math.PI * 2),
    trailAccum: 0,
    stepSide: 1,
    prevFootX: footX,
    prevFootY: footY
  });
}

/**
 * 캐릭터 발밑 이동 흔적(스키 마크 / 물보라 / 발자국·낙엽 / 봄꽃) 기록
 */
function emitTrailForSprite(theme, s, footX, footY, relVx, relVy) {
  const speed = Math.hypot(relVx, relVy) || 1;
  // 이동 방향의 수직 단위벡터 (두 줄 스키 마크 / 좌우 발자국 간격용)
  const nx = -relVy / speed;
  const ny = relVx / speed;

  if (theme === 'winter') {
    trailEffects.push({
      kind: 'ski',
      x1: s.prevFootX,
      y1: s.prevFootY,
      x2: footX,
      y2: footY,
      nx,
      ny,
      life: 0,
      maxLife: 1.05
    });
  } else if (theme === 'summer') {
    trailEffects.push({
      kind: 'ripple',
      x: footX,
      y: footY,
      r: 4,
      maxR: rand(15, 23),
      life: 0,
      maxLife: 0.75
    });
    // 물장구 물보라 물방울 3개 톡톡 튀김
    for (let k = 0; k < 3; k++) {
      const sideSign = k === 0 ? -1 : (k === 1 ? 1 : (Math.random() < 0.5 ? -1 : 1));
      trailEffects.push({
        kind: 'droplet',
        x: footX + rand(-4, 4),
        y: footY + rand(-2, 2),
        vx: nx * sideSign * rand(14, 32) + rand(-6, 6),
        vy: -rand(10, 26),
        r: rand(1.8, 3.2),
        life: 0,
        maxLife: 0.48
      });
    }
  } else if (theme === 'autumn') {
    s.stepSide *= -1;
    trailEffects.push({
      kind: 'footstep',
      x: footX + nx * s.stepSide * 4.5,
      y: footY + ny * s.stepSide * 4.5,
      angle: Math.atan2(relVy, relVx),
      rustleColor: Math.random() < 0.5 ? '#ea580c' : '#eab308',
      life: 0,
      maxLife: 0.95
    });
  } else {
    // spring: 작은 꽃송이 피어남
    const colors = ['#f472b6', '#fb7185', '#facc15', '#c084fc'];
    trailEffects.push({
      kind: 'blossom_pop',
      x: footX + rand(-6, 6),
      y: footY + rand(-3, 3),
      r: rand(3.5, 5.5),
      color: pickRandom(colors),
      rot: rand(0, Math.PI),
      life: 0,
      maxLife: 0.95
    });
  }
}

/**
 * 배경 캔버스 렌더링 (계절 그라데이션 + 스크롤되는 바닥 오브젝트 + 캐릭터 발밑 흔적)
 */
function drawBackgroundAndTrails(ctx, theme, w, h, tsSec) {
  ctx.clearRect(0, 0, w, h);

  // 1. 계절별 베이스 바닥 그라데이션
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  if (theme === 'winter') {
    grad.addColorStop(0, '#eef6ff');
    grad.addColorStop(0.55, '#f8fbff');
    grad.addColorStop(1, '#e4f0fe');
  } else if (theme === 'summer') {
    grad.addColorStop(0, '#38bdf8');
    grad.addColorStop(0.5, '#60cdff');
    grad.addColorStop(1, '#bae6fd');
  } else if (theme === 'autumn') {
    grad.addColorStop(0, '#fef3c7');
    grad.addColorStop(0.55, '#fde68a');
    grad.addColorStop(1, '#fed7aa');
  } else {
    grad.addColorStop(0, '#ecfccb');
    grad.addColorStop(0.55, '#dcfce7');
    grad.addColorStop(1, '#d1fae5');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // 2. 위로 스크롤되는 지형 오브젝트 렌더링
  for (const p of groundProps) {
    ctx.save();
    if (theme === 'winter') {
      if (p.kind === 'mound') {
        // 작은 눈 언덕 범프
        ctx.strokeStyle = `rgba(186, 214, 247, ${p.alpha})`;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 1.7, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      } else {
        // 굴러 올라가는 작은 눈덩이
        ctx.fillStyle = `rgba(191, 219, 254, ${p.alpha * 0.65})`;
        ctx.beginPath();
        ctx.arc(p.x + 1, p.y + 1.5, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255, 255, 255, ${p.alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (theme === 'summer') {
      // 파란 물결 위 반짝이는 윤슬(Caustic shimmer)
      const shimmer = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(tsSec * p.speed + p.phase));
      if (p.kind === 'wave') {
        ctx.strokeStyle = `rgba(255, 255, 255, ${shimmer * 0.65})`;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x - p.r, p.y);
        ctx.quadraticCurveTo(p.x - p.r * 0.5, p.y - 3.5, p.x, p.y);
        ctx.quadraticCurveTo(p.x + p.r * 0.5, p.y + 3.5, p.x + p.r, p.y);
        ctx.stroke();
      } else {
        // 다이아몬드 빛망울 윤슬
        const sr = 3.5 * shimmer + 1.2;
        ctx.fillStyle = `rgba(255, 255, 255, ${shimmer * 0.9})`;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - sr * 1.4);
        ctx.lineTo(p.x + sr, p.y);
        ctx.lineTo(p.x, p.y + sr * 1.4);
        ctx.lineTo(p.x - sr, p.y);
        ctx.closePath();
        ctx.fill();
      }
    } else if (theme === 'autumn') {
      // 바닥에 깔린 단풍잎·은행잎
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      if (p.kind === 'ginkgo') {
        ctx.arc(0, 0, p.r, 0.2, Math.PI - 0.2);
        ctx.lineTo(0, -p.r * 0.6);
      } else {
        ctx.ellipse(0, 0, p.r * 1.15, p.r * 0.65, 0, 0, Math.PI * 2);
      }
      ctx.closePath();
      ctx.fill();
    } else {
      // 봄 풀밭 새싹과 민들레
      ctx.globalAlpha = p.alpha;
      if (p.kind === 'grass') {
        ctx.strokeStyle = '#65a30d';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p.x - 3, p.y - 3);
        ctx.lineTo(p.x, p.y + 2);
        ctx.lineTo(p.x + 3, p.y - 3.5);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // 3. 캐릭터가 지나간 흔적(스키 마크 / 물보라 / 발자국 / 꽃보라) 렌더링
  for (const t of trailEffects) {
    const progress = t.life / t.maxLife;
    const alpha = Math.max(0, 1 - progress);
    ctx.save();

    if (t.kind === 'ski') {
      // 두 줄 평행 스키 마크
      const gap = 5.2;
      ctx.strokeStyle = `rgba(125, 168, 218, ${alpha * 0.72})`;
      ctx.lineWidth = 2.1;
      ctx.lineCap = 'round';
      for (const sign of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(t.x1 + t.nx * gap * sign, t.y1 + t.ny * gap * sign);
        ctx.lineTo(t.x2 + t.nx * gap * sign, t.y2 + t.ny * gap * sign);
        ctx.stroke();
      }
    } else if (t.kind === 'ripple') {
      const curR = t.r + (t.maxR - t.r) * progress;
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.85})`;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.ellipse(t.x, t.y, curR, curR * 0.58, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (t.kind === 'droplet') {
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.95})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r * (1 - progress * 0.3), 0, Math.PI * 2);
      ctx.fill();
    } else if (t.kind === 'footstep') {
      ctx.translate(t.x, t.y);
      ctx.rotate(t.angle);
      ctx.fillStyle = `rgba(146, 64, 14, ${alpha * 0.42})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, 3.4, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
      // 밟힐 때 톡 튀는 작은 낙엽 조각
      ctx.fillStyle = t.rustleColor;
      ctx.globalAlpha = alpha * 0.75;
      ctx.beginPath();
      ctx.arc(-4 - progress * 5, (progress - 0.5) * 6, 2.0, 0, Math.PI * 2);
      ctx.fill();
    } else if (t.kind === 'blossom_pop') {
      const scale = Math.sin(Math.min(1, progress * 2.2) * (Math.PI * 0.5));
      const r = t.r * scale;
      ctx.translate(t.x, t.y);
      ctx.rotate(t.rot + progress * 0.8);
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = t.color;
      for (let pIdx = 0; pIdx < 5; pIdx++) {
        const ang = (pIdx * Math.PI * 2) / 5;
        ctx.beginPath();
        ctx.arc(Math.cos(ang) * r * 0.65, Math.sin(ang) * r * 0.65, r * 0.48, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

/**
 * 전경 하늘 파티클(눈송이 / 윤슬 스파클 / 떨어지는 단풍잎 / 흩날리는 벚꽃잎) 렌더링
 */
function drawSkyParticles(ctx, theme, w, h) {
  ctx.clearRect(0, 0, w, h);

  for (const p of skyParticles) {
    ctx.save();
    if (theme === 'winter') {
      const drawX = p.x + Math.sin(p.age * p.swayFreq) * p.swayAmp;
      ctx.fillStyle = `rgba(255, 255, 255, ${p.alpha})`;
      ctx.shadowColor = 'rgba(148, 163, 184, 0.35)';
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(drawX, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    } else if (theme === 'summer') {
      const pulse = Math.max(0, Math.sin(p.age * p.swayFreq));
      const r = p.r * pulse;
      if (r > 0.4) {
        ctx.fillStyle = `rgba(255, 255, 255, ${pulse * 0.85})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (theme === 'autumn') {
      const drawX = p.x + Math.sin(p.age * p.swayFreq) * p.swayAmp;
      ctx.translate(drawX, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(0, -p.r);
      ctx.quadraticCurveTo(p.r, -p.r * 0.2, p.r * 0.4, p.r);
      ctx.lineTo(0, p.r * 0.65);
      ctx.lineTo(-p.r * 0.4, p.r);
      ctx.quadraticCurveTo(-p.r, -p.r * 0.2, 0, -p.r);
      ctx.fill();
    } else {
      // 봄 벚꽃잎
      const drawX = p.x + Math.sin(p.age * p.swayFreq) * p.swayAmp;
      ctx.translate(drawX, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r, p.r * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function syncCanvasResolution(canvas, w, h) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const targetW = Math.max(1, Math.round(w * dpr));
  const targetH = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/**
 * 첫 화면 우하단 카드(.mode-info-card) 내 사계절 인터랙티브 배경 + 유영 캐릭터 스테이지 기동
 * @param {HTMLElement} containerEl #info-floating-stage 엘리먼트
 * @param {Array<object>} charsPool 현재 선택된 도메인/시즌 캐릭터 배열
 */
export function startSeasonalStage(containerEl, charsPool) {
  stopSeasonalStage();
  if (!containerEl || !charsPool || charsPool.length === 0) return;

  containerEl.innerHTML = `
    <canvas class="season-bg-canvas"></canvas>
    <div class="season-sprite-layer"></div>
    <canvas class="season-fg-canvas"></canvas>
  `;

  const bgCanvas = containerEl.querySelector('.season-bg-canvas');
  const spriteLayer = containerEl.querySelector('.season-sprite-layer');
  const fgCanvas = containerEl.querySelector('.season-fg-canvas');

  const rect = containerEl.getBoundingClientRect();
  stageWidth = rect.width || 280;
  stageHeight = rect.height || 260;

  const theme = currentSeasonTheme;
  initGroundProps(theme, stageWidth, stageHeight);
  initSkyParticles(theme, stageWidth, stageHeight);

  // 초기 6마리 배치 후 최대 10마리까지 순차 진입
  const initialCount = Math.min(6, MAX_FLOATING_CHARS);
  for (let i = 0; i < initialCount; i++) {
    spawnCharacterSprite(spriteLayer, charsPool, i < 4);
  }

  spawnTimerId = setInterval(() => {
    if (!containerEl.isConnected) {
      stopSeasonalStage();
      return;
    }
    if (activeSprites.length < MAX_FLOATING_CHARS) {
      spawnCharacterSprite(spriteLayer, charsPool, false);
    }
  }, 520);

  const step = (ts) => {
    if (!containerEl.isConnected) {
      stopSeasonalStage();
      return;
    }

    if (!lastFrameTs) lastFrameTs = ts;
    const dt = Math.min(0.05, (ts - lastFrameTs) / 1000);
    lastFrameTs = ts;
    const tsSec = ts / 1000;

    const liveRect = containerEl.getBoundingClientRect();
    if (liveRect.width > 10 && liveRect.height > 10) {
      stageWidth = liveRect.width;
      stageHeight = liveRect.height;
    }

    const activeTheme = currentSeasonTheme;

    // 1) 바닥 지형 위로 끝없이 스크롤
    for (let i = 0; i < groundProps.length; i++) {
      const p = groundProps[i];
      p.y -= GROUND_SCROLL_SPEED * dt;
      if (p.y < -28) {
        groundProps[i] = makeGroundProp(activeTheme, stageWidth, stageHeight + rand(4, 24));
      }
    }

    // 2) 캐릭터 간 부드러운 거리 유지 (겹침 완화)
    for (let i = 0; i < activeSprites.length; i++) {
      for (let j = i + 1; j < activeSprites.length; j++) {
        const a = activeSprites[i];
        const b = activeSprites[j];
        const dx = (b.x + b.size * 0.5) - (a.x + a.size * 0.5);
        const dy = (b.y + b.size * 0.5) - (a.y + a.size * 0.5);
        const dist = Math.hypot(dx, dy) || 1;
        const minDist = (a.size + b.size) * 0.5;
        if (dist < minDist) {
          const push = (minDist - dist) * 26 * dt;
          const nx = dx / dist;
          const ny = dy / dist;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
        }
      }
    }

    // 3) 캐릭터 슬라럼 이동 및 발밑 흔적(스키 마크·물보라·발자국·꽃보라) 생성
    const trailIntervalDist = activeTheme === 'winter' ? 7 : (activeTheme === 'summer' ? 16 : 18);

    for (let i = activeSprites.length - 1; i >= 0; i--) {
      const s = activeSprites[i];
      s.age += dt;

      const slalomVx = Math.cos(s.age * s.slalomFreq) * s.slalomAmp;
      const vx = s.baseVx + slalomVx;
      const vy = s.vy;

      // 지면과 함께 위로 밀려 올라간 이전 발 위치 보정 (스키 트랙이 끊기지 않고 바닥에 이어지도록!)
      s.prevFootY -= GROUND_SCROLL_SPEED * dt;

      s.x += vx * dt;
      s.y += vy * dt;

      const footX = s.x + s.size * 0.5;
      const footY = s.y + s.size * 0.84;

      // 바닥 기준 상대 이동 벡터 (배경이 위로 올라가므로 캐릭터는 상대적으로 빠르게 아래/대각선으로 활주)
      const relVx = vx;
      const relVy = vy + GROUND_SCROLL_SPEED;
      const movedOnGround = Math.hypot(footX - s.prevFootX, footY - s.prevFootY);
      s.trailAccum += movedOnGround;

      if (s.trailAccum >= trailIntervalDist) {
        emitTrailForSprite(activeTheme, s, footX, footY, relVx, relVy);
        s.prevFootX = footX;
        s.prevFootY = footY;
        s.trailAccum = 0;
      }

      const margin = s.size + 22;
      if (s.y > stageHeight + margin || s.x < -margin || s.x > stageWidth + margin || s.y < -margin - 20) {
        s.el.remove();
        activeSprites.splice(i, 1);
        continue;
      }

      // 커브 방향으로 귀엽게 살짝 기울이기
      const tiltDeg = Math.max(-14, Math.min(14, -vx * 0.22));
      s.el.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0) rotate(${tiltDeg.toFixed(1)}deg)`;
    }

    // 4) 발밑 흔적 수명 및 바닥 스크롤 동기화
    for (let i = trailEffects.length - 1; i >= 0; i--) {
      const t = trailEffects[i];
      t.life += dt;
      if (t.life >= t.maxLife) {
        trailEffects.splice(i, 1);
        continue;
      }
      if (t.kind === 'ski') {
        t.y1 -= GROUND_SCROLL_SPEED * dt;
        t.y2 -= GROUND_SCROLL_SPEED * dt;
      } else if (t.kind === 'droplet') {
        t.x += t.vx * dt;
        t.y += (t.vy - GROUND_SCROLL_SPEED * 0.7) * dt;
        t.vy += 55 * dt;
      } else {
        t.y -= GROUND_SCROLL_SPEED * dt;
      }
    }

    // 5) 전경 하늘 파티클 이동 업데이트
    for (let i = 0; i < skyParticles.length; i++) {
      const p = skyParticles[i];
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.rot !== undefined) p.rot += (p.rotSpeed || 0) * dt;

      if (activeTheme === 'summer') {
        if (p.y < -10) {
          skyParticles[i] = makeSkyParticle(activeTheme, stageWidth, stageHeight, false);
          skyParticles[i].y = stageHeight + 6;
        }
      } else if (p.y > stageHeight + 20 || p.x < -30 || p.x > stageWidth + 30) {
        skyParticles[i] = makeSkyParticle(activeTheme, stageWidth, stageHeight, false);
      }
    }

    // 6) 캔버스 드로잉
    const bgCtx = syncCanvasResolution(bgCanvas, stageWidth, stageHeight);
    drawBackgroundAndTrails(bgCtx, activeTheme, stageWidth, stageHeight, tsSec);

    const fgCtx = syncCanvasResolution(fgCanvas, stageWidth, stageHeight);
    drawSkyParticles(fgCtx, activeTheme, stageWidth, stageHeight);

    rafId = requestAnimationFrame(step);
  };

  rafId = requestAnimationFrame(step);
}
