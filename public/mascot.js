/* 고양이 마스코트 — 마우스를 따라 몸을 기울이고, 빠르게 움직이면 흔들리고, 클릭할 때마다 다른 동작을 한다. */
(() => {
  const root = document.getElementById('mascot');
  if (!root) return;
  const flip = root.querySelector('.mascot-flip');
  const act = root.querySelector('.mascot-act');
  const fx = root.querySelector('.mascot-fx');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ACTIONS = ['jump', 'spin', 'wiggle', 'squish'];
  let next = 0;
  let last = { x: 0, y: 0, t: 0 };
  let frame = null;

  // 커서 쪽으로 살짝 기울고 몸을 돌린다.
  function lean(x, y) {
    const r = root.getBoundingClientRect();
    const dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
    const dist = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, dist / 400);
    root.style.transform = `translate(${(dx / dist) * 8 * k}px, ${(dy / dist) * 5 * k}px) rotate(${(dx / dist) * 7 * k}deg)`;
    flip.classList.toggle('flip', dx < -20);
  }
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

  window.addEventListener('pointermove', (e) => {
    if (reduce) return;
    const now = performance.now();
    const speed = Math.hypot(e.clientX - last.x, e.clientY - last.y) / Math.max(1, now - last.t);  // px/ms
    last = { x: e.clientX, y: e.clientY, t: now };
    if (!frame) frame = requestAnimationFrame(() => { frame = null; lean(last.x, last.y); });
    if (speed > 1.8 && !busy()) play('wiggle');
  }, { passive: true });

  window.addEventListener('pointerdown', (e) => {
    if (reduce) return;
    play(ACTIONS[next++ % ACTIONS.length]);
    hearts(e.target.closest('#btn-yes') ? 6 : 1);   // "비플페이 가능"을 누르면 하트가 잔뜩
  }, { passive: true });

  act.addEventListener('animationend', (e) => { if (e.target === act) act.classList.remove(...ACTIONS); });
})();
