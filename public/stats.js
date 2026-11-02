(() => {
  const rows = document.getElementById('rows');
  const msg = document.getElementById('msg');
  const pct = (v) => (v == null ? '–' : (v * 100).toFixed(1));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function load() {
    msg.textContent = '';
    try {
      const res = await fetch('/api/stats');
      const stats = await res.json();
      if (!res.ok) throw new Error(stats.error || res.statusText);
      rows.innerHTML = '';
      for (const r of stats.regions) rows.appendChild(row(r, false));
      rows.appendChild(row(stats.all, true));
      if (!stats.regions.length) msg.textContent = '아직 수집한 지역이 없습니다.';
    } catch (e) {
      msg.textContent = '통계를 불러오지 못했습니다: ' + e.message;
    }
  }

  function row(r, isTotal) {
    const tr = document.createElement('tr');
    if (isTotal) tr.className = 'total';
    const name = isTotal ? esc(r.name) : `<a href="/#r=${r.id}">${esc(r.name)}</a>`;
    tr.innerHTML = `<td>${name}</td><td>${r.total}</td><td>${r.surveyed}</td><td>${pct(r.progress)}</td><td>${r.yes}</td><td>${r.no}</td><td>${pct(r.rate)}</td><td></td>`;
    if (!isTotal) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-del';
      btn.textContent = '삭제';
      btn.addEventListener('click', () => remove(r));
      tr.lastElementChild.appendChild(btn);
    }
    return tr;
  }

  async function remove(r) {
    const typed = prompt(`삭제하려면 지역 이름을 입력하세요: ${r.name}`);
    if (typed == null) return;
    if (typed.trim() !== r.name) { alert('이름이 일치하지 않아 삭제하지 않았습니다.'); return; }
    try {
      const res = await fetch('/api/regions/' + r.id, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      await load();
    } catch (e) {
      alert('삭제하지 못했습니다: ' + e.message);
    }
  }

  load();
})();
