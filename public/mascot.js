/* 고양이 마스코트 — 지도 한가운데를 날아다니고, 마우스를 따라 몸을 기울이고, 빠르게 움직이면 흔들리고,
   클릭하면 그 자리로 날아가며 클릭할 때마다 다른 동작(점프·회전·흔들기·찌부)을 한다. */
(() => {
  const root = document.getElementById('mascot');
  const wrap = document.getElementById('map-wrap');
  if (!root || !wrap) return;
  const flip = root.querySelector('.mascot-flip');
  const act = root.querySelector('.mascot-act');
  const fx = root.querySelector('.mascot-fx');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ACTIONS = ['jump', 'spin', 'wiggle', 'squish'];
  let next = 0;
  let last = { x: 0, y: 0, t: 0 };
  let lean = 0;              // 커서 쪽으로 기우는 각도
  let pos = null;            // 지도 영역 안의 현재 위치 (중심점)
  let target = null;         // 날아가는 목표
  let restUntil = 0;         // 목표에 닿은 뒤 잠깐 쉬는 시각
  const SPEED = 140;         // px/초

  // 화면 가운데 쪽(가로 20~80%, 세로 15~60%)에서 다음 목적지를 고른다.
  function pickTarget() {
    const r = wrap.getBoundingClientRect();
    return { x: r.width * (0.2 + Math.random() * 0.6), y: r.height * (0.15 + Math.random() * 0.45) };
  }
  function place(x, y) {
    const r = root.getBoundingClientRect();
    root.style.transform = `translate(${x - r.width / 2}px, ${y - r.height / 2}px) rotate(${lean}deg)`;
  }
  let prevT = performance.now();
  function tick(t) {
    const dt = Math.min(0.05, (t - prevT) / 1000);
    prevT = t;
    if (!pos) { pos = pickTarget(); target = pickTarget(); }
    if (t > restUntil) {
      const dx = target.x - pos.x, dy = target.y - pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 3) { target = pickTarget(); restUntil = t + 800 + Math.random() * 1500; }
      else {
        const step = Math.min(dist, SPEED * dt);
        pos.x += (dx / dist) * step;
        pos.y += (dy / dist) * step;
        flip.classList.toggle('flip', dx < 0);   // 가는 방향을 본다
      }
    }
    const bob = reduce ? 0 : Math.sin(t / 420) * 7;   // 둥실둥실
    place(pos.x, pos.y + bob);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function play(name) {
    if (reduce) return;
    act.classList.remove(...ACTIONS);
    void act.offsetWidth;   // 같은 동작을 연달아 해도 다시 재생되게
    act.classList.add(name);
  }
  const busy = () => ACTIONS.some((a) => act.classList.contains(a));
  function hearts(n) {
    for (let i = 0; i < n; i++) {
      const h = document.createElement('span');
      h.className = 'heart';
      h.textContent = '♥';
      h.style.left = 25 + Math.random() * 50 + '%';
      h.style.animationDelay = i * 90 + 'ms';
      fx.appendChild(h);
      setTimeout(() => h.remove(), 1300 + i * 90);
    }
  }
  // 화면 좌표 → 지도 영역 좌표 (가장자리는 피한다)
  function toWrap(clientX, clientY) {
    const r = wrap.getBoundingClientRect();
    const m = 70;
    return { x: Math.min(r.width - m, Math.max(m, clientX - r.left)), y: Math.min(r.height - m, Math.max(m, clientY - r.top)) };
  }

  window.addEventListener('pointermove', (e) => {
    if (reduce) return;
    const now = performance.now();
    const speed = Math.hypot(e.clientX - last.x, e.clientY - last.y) / Math.max(1, now - last.t);  // px/ms
    last = { x: e.clientX, y: e.clientY, t: now };
    const r = root.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    lean = Math.max(-10, Math.min(10, dx / 40));          // 커서 쪽으로 살짝 기운다
    if (speed > 1.8 && !busy()) play('wiggle');
  }, { passive: true });

  window.addEventListener('pointerdown', (e) => {
    if (reduce) return;
    play(ACTIONS[next++ % ACTIONS.length]);
    hearts(e.target.closest('#btn-yes') ? 6 : 1);          // "비플페이 가능"을 누르면 하트가 잔뜩
    target = toWrap(e.clientX, e.clientY);                 // 클릭한 곳으로 날아간다
    restUntil = 0;
  }, { passive: true });

  act.addEventListener('animationend', (e) => { if (e.target === act) act.classList.remove(...ACTIONS); });
})();
