/**
 * @file components/weather-layer.js
 * @description 처음 화면 안내 카드의 계절 무대(seasonal-stage.js) 위에 지금 날씨를 겹치는 얇은 층.
 * 비·뇌우 = 빗줄기(뇌우는 가끔 번쩍) · 눈 = 눈송이 · 흐림 = 구름 · 안개 = 뿌연 막 · 맑음 = 햇빛(밤에는 별).
 * 날씨는 season-weather.js 가 IP 위치로 짐작한다(위치 권한 없음). QuizApp Common GUI 「계절·날씨 무대」.
 * 카드가 화면에서 사라지면 스스로 멈춘다. 움직임 줄이기 설정이면 한 장면만 그린다.
 */

const rand = (min, max) => min + Math.random() * (max - min);

let rafId = null;

export function stopWeatherLayer() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
}

/**
 * @param {HTMLElement} container 날씨를 겹칠 카드
 * @param {{kind: string, isDay: boolean}|null} weather 없으면 층을 지운다
 */
export function startWeatherLayer(container, weather) {
  stopWeatherLayer();
  container.querySelector('.weather-layer')?.remove();
  if (!weather) return;

  const kind = weather.kind;
  const isNight = !weather.isDay;
  const canvas = document.createElement('canvas');
  canvas.className = 'weather-layer';
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let w = 0;
  let h = 0;
  const resize = () => {
    const rect = container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, rect.width);
    h = Math.max(1, rect.height);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();

  const count = { rain: 40, thunder: 50, snow: 36 }[kind] || 0;
  const makeDrop = (anywhere) => ({
    x: rand(-20, w), y: anywhere ? rand(0, h) : rand(-40, -5), len: rand(8, 14), r: rand(1.2, 2.6),
    vy: kind === 'snow' ? rand(14, 26) : rand(180, 260), vx: kind === 'snow' ? rand(-6, 6) : 40
  });
  const drops = Array.from({ length: count }, () => makeDrop(true));
  const clouds = (kind === 'cloudy' || kind === 'rain' || kind === 'thunder')
    ? Array.from({ length: 3 }, (_, i) => ({ x: rand(0, w), y: 10 + i * 16, s: rand(0.8, 1.3), vx: rand(4, 9) })) : [];
  const stars = (kind === 'clear' && isNight) ? Array.from({ length: 14 }, () => ({ x: rand(0, w), y: rand(0, h * 0.6), p: rand(0, 6) })) : [];
  let flash = 0;

  const draw = (t) => {
    ctx.clearRect(0, 0, w, h);
    if (isNight) { ctx.fillStyle = 'rgba(30, 41, 59, 0.10)'; ctx.fillRect(0, 0, w, h); }
    if (kind === 'clear' && !isNight) {
      const sun = ctx.createRadialGradient(w - 18, 18, 2, w - 18, 18, 60);
      sun.addColorStop(0, 'rgba(253, 224, 71, 0.5)');
      sun.addColorStop(1, 'rgba(253, 224, 71, 0)');
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, w, h);
    }
    stars.forEach((s) => {
      ctx.fillStyle = `rgba(250, 204, 21, ${0.35 + 0.35 * Math.sin(t * 2 + s.p)})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, 1.4, 0, Math.PI * 2); ctx.fill();
    });
    clouds.forEach((c) => {
      ctx.fillStyle = kind === 'cloudy' ? 'rgba(148, 163, 184, 0.28)' : 'rgba(100, 116, 139, 0.32)';
      [[0, 0, 16], [14, -5, 13], [28, 0, 15], [14, 5, 12]].forEach(([dx, dy, r]) => {
        ctx.beginPath(); ctx.arc(c.x + dx * c.s, c.y + dy * c.s, r * c.s, 0, Math.PI * 2); ctx.fill();
      });
    });
    if (kind === 'snow') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      drops.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); });
    } else if (drops.length) {
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.35)';
      ctx.lineWidth = 1;
      drops.forEach((p) => { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.len * 0.2, p.y - p.len); ctx.stroke(); });
    }
    if (kind === 'fog') { ctx.fillStyle = 'rgba(241, 245, 249, 0.45)'; ctx.fillRect(0, 0, w, h); }
    if (flash > 0) { ctx.fillStyle = `rgba(255, 255, 255, ${flash * 0.5})`; ctx.fillRect(0, 0, w, h); }
  };

  const step = (dt) => {
    drops.forEach((p, i) => {
      p.y += p.vy * dt; p.x += p.vx * dt;
      if (p.y > h + 10) drops[i] = makeDrop(false);
    });
    clouds.forEach((c) => { c.x += c.vx * dt; if (c.x > w + 60) c.x = -60; });
    if (kind === 'thunder') {
      flash = Math.max(0, flash - dt * 3);
      if (Math.random() < dt * 0.08) flash = 1;
    }
  };

  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    draw(0);
    return;
  }

  let last = performance.now();
  const loop = (now) => {
    if (!canvas.isConnected) { stopWeatherLayer(); return; }
    const rect = container.getBoundingClientRect();
    if (Math.abs(rect.width - w) > 1 || Math.abs(rect.height - h) > 1) resize();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    draw(now / 1000);
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}
