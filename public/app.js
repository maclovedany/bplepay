/* 비플페이 가맹점 현장조사 지도 — 화면 로직 */
(() => {
  const $ = (id) => document.getElementById(id);
  const el = {
    panel: $('panel'), form: $('search-form'), input: $('search-input'), clear: $('search-clear'),
    recent: $('recent'), recentList: $('recent-regions'), recentEmpty: $('recent-empty'), recentChips: $('recent-chips'),
    status: $('status'), collecting: $('status-collecting'), failed: $('status-failed'), error: $('status-error'), retry: $('retry-btn'),
    region: $('region'), name: $('region-name'), source: $('region-source'), stats: $('region-stats'), ai: $('region-ai'),
    suggestions: $('suggestions'), suggestionList: $('suggestion-list'),
    excluded: $('region-excluded'), catFilter: $('cat-filter'), catFilterLabel: $('cat-filter-label'), catFilterOff: $('cat-filter-off'),
    chips: $('filter-chips'), list: $('place-list'),
    sheet: $('sheet'), sheetClose: $('sheet-close'), sheetName: $('sheet-name'), sheetCat: $('sheet-category'),
    sheetAddr: $('sheet-address'), sheetPhone: $('sheet-phone'), btnYes: $('btn-yes'), btnNo: $('btn-no'),
    handle: $('sheet-handle'),
  };

  const state = { regionId: null, region: null, places: [], filter: 'all', selected: null, pollTimer: null, refreshTimer: null, query: '', catFilter: null };
  const markers = new Map();
  let polygonLayer = null;

  // ---------- 지도 ----------
  const map = L.map('map', { zoomControl: true, attributionControl: true }).setView([35.868, 128.597], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap',
  }).addTo(map);
  // 핀이 수백 개라 이름표는 충분히 확대했을 때만 보인다.
  const LABEL_ZOOM = 18;
  const syncLabelZoom = () => map.getContainer().classList.toggle('show-labels', map.getZoom() >= LABEL_ZOOM);
  map.on('zoomend', syncLabelZoom);
  syncLabelZoom();
  const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

  const api = async (path, opts = {}) => {
    const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...opts });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || res.statusText);
    return body;
  };

  // ---------- 초기 화면: 최근 지역 ----------
  async function loadRecent() {
    try {
      const { regions } = await api('/api/regions');
      renderRecentChips(regions);
      el.recentList.innerHTML = '';
      el.recentEmpty.hidden = regions.length > 0;
      for (const r of regions) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        const meta = r.stats ? `식당 ${r.stats.total} · 조사 ${r.stats.surveyed} · 가능 ${r.stats.yes}` : '';
        const statusText = { collecting: '수집 중', failed: '실패', ready: '' }[r.status] ?? r.status;
        btn.innerHTML = `<span class="r-name">${esc(r.name)}</span><span class="r-meta">${esc(meta)}${statusText ? ` <span class="r-status ${r.status}">${statusText}</span>` : ''}</span>`;
        btn.addEventListener('click', () => openRegion(r.id));
        li.appendChild(btn);
        el.recentList.appendChild(li);
      }
    } catch (e) {
      el.recentEmpty.hidden = false;
      el.recentEmpty.textContent = '목록을 불러오지 못했습니다: ' + e.message;
    }
  }

  // ---------- 검색 ----------
  el.form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const query = el.input.value.trim().replace(/\s+/g, ' ');
    if (!query) return;
    state.query = query;
    showStatus('collecting');
    try {
      const { id } = await api('/api/regions', { method: 'POST', body: JSON.stringify({ query }) });
      openRegion(id, query);
    } catch (e) {
      showStatus('failed', e.message);
    }
  });
  el.input.addEventListener('input', () => { el.clear.hidden = !el.input.value; });
  el.clear.addEventListener('click', () => { el.input.value = ''; el.clear.hidden = true; el.input.focus(); });
  el.retry.addEventListener('click', async () => {
    const query = state.query || state.region?.name;
    if (!query) return;
    showStatus('collecting');
    try {
      const { id } = await api('/api/regions', { method: 'POST', body: JSON.stringify({ query }) });
      openRegion(id);
    } catch (e) { showStatus('failed', e.message); }
  });

  function showStatus(kind, message, suggestions = []) {
    el.recent.hidden = true;
    el.region.hidden = true;
    el.status.hidden = false;
    el.collecting.hidden = kind !== 'collecting';
    el.failed.hidden = kind !== 'failed';
    if (kind === 'failed') el.error.textContent = message || '수집에 실패했습니다.';
    el.suggestions.hidden = !(kind === 'failed' && suggestions.length);
    el.suggestionList.innerHTML = '';
    for (const q of suggestions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = q;
      b.addEventListener('click', () => { el.input.value = q; el.clear.hidden = false; el.form.requestSubmit(); });
      el.suggestionList.appendChild(b);
    }
    closeSheet();
  }

  // 검색창 아래 한 줄: 최근 검색한 이름들. 지역을 보는 중에도 늘 보인다.
  function renderRecentChips(regions) {
    el.recentChips.innerHTML = '';
    el.recentChips.hidden = regions.length === 0;
    for (const r of regions.slice(0, 15)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (r.id === state.regionId ? ' is-active' : '') + (r.status === 'failed' ? ' is-failed' : '') + (r.status === 'collecting' ? ' is-collecting' : '');
      b.textContent = r.name;
      b.title = r.name;
      b.addEventListener('click', () => { el.input.value = r.name; el.clear.hidden = false; openRegion(r.id, r.name); });
      el.recentChips.appendChild(b);
    }
  }

  // ---------- 지역 열기 / 폴링 ----------
  function openRegion(id, query = state.query) {
    state.regionId = id;
    state.query = query || '';
    location.hash = '#r=' + id + (state.query ? '&q=' + encodeURIComponent(state.query) : '');
    clearTimeout(state.pollTimer);
    clearInterval(state.refreshTimer);
    showStatus('collecting');
    pollRegion();
    loadRecent();
  }

  const regionUrl = () => '/api/regions/' + state.regionId + (state.query ? '?q=' + encodeURIComponent(state.query) : '');

  async function pollRegion() {
    try {
      const data = await api(regionUrl());
      const { region } = data;
      if (region.status === 'ready') {
        state.catFilter = data.filter && data.filter.categories.length ? { want: data.filter.want, set: new Set(data.filter.categories) } : null;
        renderRegion(region, data.places || []);
        state.refreshTimer = setInterval(refreshSurveys, 10000);
      } else if (region.status === 'failed') {
        state.query = state.query || region.name;
        showStatus('failed', region.error, region.suggestions || []);
      } else {
        showStatus('collecting');
        state.pollTimer = setTimeout(pollRegion, 2000);
      }
    } catch (e) {
      showStatus('failed', e.message);
    }
  }

  async function refreshSurveys() {
    if (!state.regionId || !state.region) return;
    try {
      const data = await api(regionUrl());
      if (data.region.status !== 'ready') return;
      const byId = new Map(data.places.map((p) => [p.naver_id, p.survey]));
      let changed = false;
      for (const p of state.places) {
        const s = byId.get(p.naver_id) ?? null;
        if (s !== p.survey) { p.survey = s; changed = true; updateMarker(p); }
      }
      if (changed) { renderList(); renderHead(); if (state.selected) renderSheet(state.selected); }
    } catch { /* 다음 주기에 다시 */ }
  }

  // ---------- 렌더 ----------
  function renderRegion(region, places) {
    state.region = region;
    state.places = places.slice().sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    el.status.hidden = true;
    el.recent.hidden = true;
    el.region.hidden = false;
    el.name.textContent = region.name;
    el.source.textContent = region.source_name && region.source_name !== region.name ? `구획: ${region.source_name}` : '';
    const aiText = region.search_query && region.search_query !== region.name
      ? `AI 해석: ${region.name} → ${region.search_query}${region.ai_note ? ' · ' + region.ai_note : ''}`
      : (region.ai_note ? `AI: ${region.ai_note}` : '');
    el.ai.hidden = !aiText;
    el.ai.textContent = aiText;
    const ex = region.ai_excluded;
    el.excluded.hidden = !(ex && ex.count);
    if (ex && ex.count) el.excluded.textContent = `AI가 식당이 아닌 업종 ${ex.categories.length}종(${ex.categories.slice(0, 4).join(', ')}${ex.categories.length > 4 ? ' 외' : ''}) ${ex.count}곳을 제외했습니다.`;
    renderCatFilter();
    renderHead();

    if (polygonLayer) map.removeLayer(polygonLayer);
    for (const m of markers.values()) map.removeLayer(m);
    markers.clear();

    if (region.polygon) {
      polygonLayer = L.geoJSON({ type: 'Feature', geometry: region.polygon }, {
        style: { color: 'rgb(57,133,247)', weight: 2, fillColor: 'rgb(56,229,255)', fillOpacity: 0.15 },
        interactive: false,
      }).addTo(map);
      // 모바일에서는 아래 패널(46vh)에 가려지지 않게 아래쪽 여백을 준다.
      const bottomPad = isMobile() ? Math.round(window.innerHeight * 0.46) + 10 : 20;
      map.fitBounds(polygonLayer.getBounds(), { paddingTopLeft: [20, isMobile() ? 70 : 20], paddingBottomRight: [20, bottomPad] });
    }
    for (const p of state.places) addMarker(p);
    applyMarkerVisibility();
    renderList();
    closeSheet();
  }

  function renderHead() {
    const pool = state.places.filter(matchesCat);
    const total = pool.length;
    const yes = pool.filter((p) => p.survey === 'yes').length;
    const no = pool.filter((p) => p.survey === 'no').length;
    el.stats.innerHTML = `식당 <b>${total}</b> · 조사 <b>${yes + no}</b> · 가능 <b>${yes}</b> · 불가능 <b>${no}</b>`;
  }

  const matchesCat = (p) => !state.catFilter || state.catFilter.set.has(p.category);
  const matchesFilter = (p) => matchesCat(p) && (state.filter === 'all' || (state.filter === 'none' ? !p.survey : p.survey === state.filter));

  function renderCatFilter() {
    if (!state.catFilter) { el.catFilter.hidden = true; return; }
    const n = state.places.filter(matchesCat).length;
    el.catFilterLabel.textContent = `AI 필터: ${state.catFilter.want} · ${[...state.catFilter.set].join(', ')} (${n}곳)`;
    el.catFilter.hidden = false;
  }
  function applyMarkerVisibility() {
    for (const p of state.places) {
      const m = markers.get(p.naver_id);
      if (!m) continue;
      if (matchesFilter(p)) { if (!map.hasLayer(m)) m.addTo(map); }
      else if (map.hasLayer(m)) map.removeLayer(m);
    }
  }
  el.catFilterOff.addEventListener('click', () => { state.catFilter = null; renderCatFilter(); renderList(); renderHead(); applyMarkerVisibility(); });

  function renderList() {
    el.list.innerHTML = '';
    for (const p of state.places) {
      if (!matchesFilter(p)) continue;
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.id = p.naver_id;
      btn.className = state.selected?.naver_id === p.naver_id ? 'is-selected' : '';
      const badge = p.survey === 'yes' ? '<span class="badge yes">가능</span>' : p.survey === 'no' ? '<span class="badge no">불가능</span>' : '<span class="badge none">미조사</span>';
      btn.innerHTML = `<span class="p-name">${esc(p.name)}<span class="p-cat">${esc(p.category || '')}</span></span>${badge}<span class="p-addr">${esc(p.road_address || p.address || '')}</span>`;
      btn.addEventListener('click', () => select(p, true));
      li.appendChild(btn);
      el.list.appendChild(li);
    }
  }

  el.chips.addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    state.filter = chip.dataset.filter;
    for (const c of el.chips.querySelectorAll('.chip')) c.classList.toggle('is-active', c === chip);
    renderList();
    applyMarkerVisibility();
  });

  // ---------- 마커 ----------
  function iconFor(p) {
    const cls = 'pin pin-' + (p.survey || 'none') + (state.selected?.naver_id === p.naver_id ? ' is-selected' : '');
    return L.divIcon({
      className: '',
      html: `<div class="${cls}"><span class="pin-ring"></span><span class="pin-body"></span><span class="pin-label">${esc(p.name)}</span></div>`,
      iconSize: [28, 36], iconAnchor: [14, 36],
    });
  }
  function addMarker(p) {
    const m = L.marker([p.lat, p.lng], { icon: iconFor(p), riseOnHover: true });
    m.on('click', () => select(p, false));
    m.addTo(map);
    markers.set(p.naver_id, m);
  }
  function updateMarker(p) {
    const m = markers.get(p.naver_id);
    if (m) m.setIcon(iconFor(p));
  }

  // ---------- 선택 / 시트 ----------
  function select(p, fromList) {
    const prev = state.selected;
    state.selected = p;
    if (prev) updateMarker(prev);
    updateMarker(p);
    for (const b of el.list.querySelectorAll('button[data-id]')) b.classList.toggle('is-selected', b.dataset.id === p.naver_id);
    if (!fromList) {
      const b = el.list.querySelector(`button[data-id="${CSS.escape(p.naver_id)}"]`);
      b?.scrollIntoView({ block: 'nearest' });
    } else {
      map.panTo([p.lat, p.lng]);
    }
    renderSheet(p);
  }

  function renderSheet(p) {
    el.sheet.hidden = false;
    el.sheetName.textContent = p.name;
    el.sheetCat.textContent = p.category || '';
    el.sheetAddr.textContent = p.road_address || p.address || '';
    el.sheetPhone.textContent = p.phone || '';
    el.btnYes.classList.toggle('is-on', p.survey === 'yes');
    el.btnNo.classList.toggle('is-on', p.survey === 'no');
  }
  function closeSheet() {
    el.sheet.hidden = true;
    const prev = state.selected;
    state.selected = null;
    if (prev) { updateMarker(prev); renderList(); }
  }
  el.sheetClose.addEventListener('click', closeSheet);

  async function setSurvey(value) {
    const p = state.selected;
    if (!p) return;
    const next = p.survey === value ? null : value;
    const before = p.survey;
    p.survey = next;
    updateMarker(p); renderSheet(p); renderList(); renderHead(); applyMarkerVisibility();
    try {
      await api('/api/places/' + encodeURIComponent(p.naver_id) + '/survey', { method: 'PUT', body: JSON.stringify({ status: next }) });
    } catch (e) {
      p.survey = before;
      updateMarker(p); renderSheet(p); renderList(); renderHead();
      alert('저장하지 못했습니다: ' + e.message);
    }
  }
  el.btnYes.addEventListener('click', () => setSurvey('yes'));
  el.btnNo.addEventListener('click', () => setSurvey('no'));

  // ---------- 모바일 시트 손잡이 ----------
  el.handle.addEventListener('click', () => {
    if (el.panel.classList.contains('is-expanded')) { el.panel.classList.remove('is-expanded'); el.panel.classList.add('is-collapsed'); }
    else if (el.panel.classList.contains('is-collapsed')) { el.panel.classList.remove('is-collapsed'); }
    else { el.panel.classList.add('is-expanded'); }
    setTimeout(() => map.invalidateSize(), 300);
  });

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- 시작 ----------
  const hashQuery = () => { const q = location.hash.match(/[#&]q=([^&]+)/); return q ? decodeURIComponent(q[1]) : ''; };
  const m = location.hash.match(/#r=(\d+)/);
  if (m) openRegion(Number(m[1]), hashQuery());
  else loadRecent();
  window.addEventListener('hashchange', () => {
    const mm = location.hash.match(/#r=(\d+)/);
    if (mm && Number(mm[1]) !== state.regionId) openRegion(Number(mm[1]), hashQuery());
    if (!mm) { clearTimeout(state.pollTimer); clearInterval(state.refreshTimer); el.region.hidden = true; el.status.hidden = true; el.recent.hidden = false; loadRecent(); }
  });
})();
