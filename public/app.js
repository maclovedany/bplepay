/* 비플페이 가맹점 현장조사 지도 — 화면 로직 */
(() => {
  const $ = (id) => document.getElementById(id);
  const el = {
    panel: $('panel'), form: $('search-form'), input: $('search-input'), clear: $('search-clear'),
    home: $('home'), guTabs: $('gu-tabs'), dongList: $('dong-list'), viewStats: $('view-stats'), places: $('places'), recentChips: $('recent-chips'),
    status: $('status'), collecting: $('status-collecting'), failed: $('status-failed'), error: $('status-error'), retry: $('retry-btn'),
    region: $('region'), name: $('region-name'), source: $('region-source'), stats: $('region-stats'), ai: $('region-ai'),
    suggestions: $('suggestions'), suggestionList: $('suggestion-list'),
    excluded: $('region-excluded'), catFilter: $('cat-filter'), catFilterLabel: $('cat-filter-label'), catFilterOff: $('cat-filter-off'),
    chips: $('filter-chips'), list: $('place-list'),
    sheet: $('sheet'), sheetClose: $('sheet-close'), sheetName: $('sheet-name'), sheetCat: $('sheet-category'),
    sheetAddr: $('sheet-address'), sheetPhone: $('sheet-phone'), btnYes: $('btn-yes'), btnNo: $('btn-no'),
    handle: $('sheet-handle'), resizer: $('panel-resizer'), locate: $('btn-locate'), route: $('btn-route'), sheetDist: $('sheet-dist'),
    btnLike: $('btn-like'), btnDislike: $('btn-dislike'), likeCount: $('like-count'), dislikeCount: $('dislike-count'),
  };

  const state = { mode: null, viewTruncated: false, regionId: null, region: null, places: [], filter: 'all', selected: null, pollTimer: null, refreshTimer: null, query: '', catFilter: null, me: null, sort: null };  // mode: 'home'(지도 화면 안 식당) | 'region'(검색한 지역). sort: null | 'near' | 'likes'
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

  // ---------- 사이드바 너비 드래그 (데스크톱) ----------
  const PANEL_MIN = 280, PANEL_MAX = 640;
  const setPanelWidth = (w) => document.getElementById('app').style.setProperty('--panel-w', Math.min(PANEL_MAX, Math.max(PANEL_MIN, w)) + 'px');
  const savedW = Number(localStorage.getItem('panelW'));
  if (savedW) setPanelWidth(savedW);
  el.resizer.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    document.body.classList.add('is-resizing');
    const move = (e) => setPanelWidth(e.clientX);
    const up = (e) => {
      document.body.classList.remove('is-resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      localStorage.setItem('panelW', String(Math.min(PANEL_MAX, Math.max(PANEL_MIN, e.clientX))));
      map.invalidateSize();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  // ---------- 내 위치 ----------
  let meMarker = null;
  const metersBetween = (a, b) => {   // a, b: [lng, lat]
    const dx = (a[0] - b[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180);
    const dy = (a[1] - b[1]) * 110540;
    return Math.hypot(dx, dy);
  };
  const distanceTo = (p) => (state.me ? metersBetween([p.lng, p.lat], [state.me.lng, state.me.lat]) : null);
  const fmtDist = (m) => (m == null ? '' : m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`);
  function setMe(coords) {
    state.me = { lat: coords.latitude, lng: coords.longitude };
    if (!meMarker) {
      meMarker = L.circleMarker([state.me.lat, state.me.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 }).addTo(map);
      meMarker.bindTooltip('내 위치', { direction: 'top', offset: [0, -8] });
    } else meMarker.setLatLng([state.me.lat, state.me.lng]);
    if (state.mode) { renderList(); if (state.selected) renderSheet(state.selected); }
  }
  // 위치를 한 번 요청한다. 성공하면 cb(true). 실패하면 알림을 띄우고 cb(false).
  function locate(cb = () => {}) {
    if (!navigator.geolocation) { alert('이 브라우저는 위치 정보를 지원하지 않습니다.'); return cb(false); }
    navigator.geolocation.getCurrentPosition(
      (pos) => { setMe(pos.coords); cb(true); },
      (err) => { alert('위치 정보를 가져오지 못했습니다: ' + err.message + '\n브라우저의 위치 권한을 허용해 주세요.'); cb(false); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }
  // 접속하자마자 조용히 위치를 따라간다 (권한이 없으면 아무 말도 하지 않는다).
  if (navigator.geolocation) {
    navigator.geolocation.watchPosition((pos) => setMe(pos.coords), () => {}, { enableHighAccuracy: false, maximumAge: 15000 });
  }
  el.locate.addEventListener('click', () => locate((ok) => { if (ok) map.setView([state.me.lat, state.me.lng], Math.max(map.getZoom(), 17)); }));

  const api = async (path, opts = {}) => {
    const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...opts });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || res.statusText);
    return body;
  };

  // ---------- 최근 검색 칩 ----------
  async function loadRecent() {
    try {
      const { regions } = await api('/api/regions');
      renderRecentChips(regions);
    } catch { /* 칩이 없어도 화면은 쓸 수 있다 */ }
  }

  // ---------- 첫 화면: 대구 지역 바로가기 + 지도 화면 안 식당 ----------
  const GUS = Object.keys(window.DAEGU_DONGS || {});
  let currentGu = GUS[0];
  function renderDaegu() {
    el.guTabs.innerHTML = '';
    for (const gu of GUS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (gu === currentGu ? ' is-active' : '');
      b.textContent = gu;
      b.addEventListener('click', () => { currentGu = gu; renderDaegu(); });
      el.guTabs.appendChild(b);
    }
    el.dongList.innerHTML = '';
    for (const dong of window.DAEGU_DONGS[currentGu]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = dong;
      // 동 이름만으로는 다른 시와 겹칠 수 있어 "대구 중구 삼덕동" 꼴로 검색한다. 이미 수집한 곳이면 바로 열린다.
      b.addEventListener('click', () => { el.input.value = `대구 ${currentGu} ${dong}`; el.clear.hidden = false; el.form.requestSubmit(); });
      el.dongList.appendChild(b);
    }
  }
  renderDaegu();

  const VIEW_MIN_ZOOM = 15;   // 이보다 멀리서 보면 식당이 너무 많아 불러오지 않는다
  let viewSeq = 0;
  function goHome() {
    state.mode = 'home';
    state.regionId = null; state.region = null; state.query = ''; state.catFilter = null;
    clearTimeout(state.pollTimer);
    clearInterval(state.refreshTimer);
    el.status.hidden = true;
    el.region.hidden = true;
    el.home.hidden = false;
    el.places.hidden = false;
    if (polygonLayer) { map.removeLayer(polygonLayer); polygonLayer = null; }
    closeSheet();
    loadRecent();
    loadView();
  }

  async function loadView() {
    if (state.mode !== 'home') return;
    const seq = ++viewSeq;
    if (map.getZoom() < VIEW_MIN_ZOOM) { setViewPlaces([], false); return; }
    const b = map.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => v.toFixed(5)).join(',');
    if (!state.places.length) el.viewStats.textContent = '이 화면의 식당을 불러오는 중…';
    try {
      const { places, truncated } = await api('/api/places?bbox=' + bbox);
      if (seq !== viewSeq || state.mode !== 'home') return;   // 그 사이 지도를 또 움직였거나 지역을 열었다
      setViewPlaces(places, truncated);
    } catch (e) {
      if (seq === viewSeq) el.viewStats.textContent = '식당을 불러오지 못했습니다: ' + e.message;
    }
  }

  // 화면 안 식당이 바뀌면 마커는 달라진 것만 더하고 뺀다 (지도를 움직일 때 깜빡이지 않게).
  function setViewPlaces(places, truncated) {
    state.viewTruncated = truncated;
    state.places = places.slice().sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    const ids = new Set(state.places.map((p) => p.naver_id));
    for (const [id, m] of markers) if (!ids.has(id)) { map.removeLayer(m); markers.delete(id); }
    for (const p of state.places) {
      if (markers.has(p.naver_id)) { markers.get(p.naver_id).off('click').on('click', () => select(p, false)); updateMarker(p); }
      else addMarker(p);
    }
    if (state.selected) {
      const same = state.places.find((p) => p.naver_id === state.selected.naver_id);
      if (same) { state.selected = same; updateMarker(same); renderSheet(same); }
    }
    applyMarkerVisibility();
    renderList();
    renderHead();
  }
  let viewTimer = null;
  map.on('moveend', () => { clearTimeout(viewTimer); viewTimer = setTimeout(loadView, 300); });

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
    el.home.hidden = true;
    el.region.hidden = true;
    el.places.hidden = true;
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
      const active = r.id === state.regionId || (state.region && r.id === state.region.id); // 병합된 검색은 대상 지역 칩을 켠다
      b.className = 'chip' + (active ? ' is-active' : '') + (r.status === 'failed' ? ' is-failed' : '') + (r.status === 'collecting' ? ' is-collecting' : '');
      b.textContent = r.name;
      b.title = r.name;
      b.addEventListener('click', () => { el.input.value = r.name; el.clear.hidden = false; openRegion(r.id, r.name); });
      el.recentChips.appendChild(b);
    }
  }

  // ---------- 지역 열기 / 폴링 ----------
  function openRegion(id, query = state.query) {
    state.mode = 'region';
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
      const byId = new Map(data.places.map((p) => [p.naver_id, p]));
      let changed = false;
      for (const p of state.places) {
        const n = byId.get(p.naver_id);
        const s = n?.survey ?? null;
        if (s !== p.survey) { p.survey = s; changed = true; updateMarker(p); }
        if (n && ((n.likes || 0) !== (p.likes || 0) || (n.dislikes || 0) !== (p.dislikes || 0))) { p.likes = n.likes || 0; p.dislikes = n.dislikes || 0; changed = true; }
      }
      if (changed) { renderList(); renderHead(); if (state.selected) renderSheet(state.selected); }
    } catch { /* 다음 주기에 다시 */ }
  }

  // ---------- 렌더 ----------
  function renderRegion(region, places) {
    state.region = region;
    state.places = places.slice().sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    el.status.hidden = true;
    el.home.hidden = true;
    el.region.hidden = false;
    el.places.hidden = false;
    el.name.textContent = region.name;
    el.source.textContent = region.source_kind === 'public'
      ? `네이버에 구획이 없어 공공데이터(소상공인 상가정보)로 수집했습니다 · ${region.source_name || ''}`
      : (region.source_name && region.source_name !== region.name ? `구획: ${region.source_name}` : '');
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
        style: region.source_kind === 'public'
          ? { color: '#a05a00', weight: 2, dashArray: '6 6', fillColor: '#ffb84d', fillOpacity: 0.12 }   // 공공데이터 구획은 점선
          : { color: 'rgb(57,133,247)', weight: 2, fillColor: 'rgb(56,229,255)', fillOpacity: 0.15 },
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
    const line = `식당 <b>${total}</b> · 조사 <b>${yes + no}</b> · 가능 <b>${yes}</b> · 불가능 <b>${no}</b>`;
    if (state.mode !== 'home') { el.stats.innerHTML = line; return; }
    if (map.getZoom() < VIEW_MIN_ZOOM) el.viewStats.textContent = '지도를 더 확대하면 이미 수집된 식당이 보입니다. 새 지역은 위에서 검색하거나 동을 누르세요.';
    else if (!total) el.viewStats.textContent = '이 화면에는 수집된 식당이 없습니다. 위에서 동을 눌러 수집해 보세요.';
    else el.viewStats.innerHTML = line + (state.viewTruncated ? ' <span class="view-more">· 일부만 표시 — 확대하면 전부 보입니다</span>' : '');
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
    let rows = state.places.filter(matchesFilter);
    if (state.sort === 'near' && state.me) rows = rows.map((p) => [distanceTo(p), p]).sort((a, b) => a[0] - b[0]).map(([, p]) => p);
    else if (state.sort === 'likes') rows = rows.slice().sort((a, b) => (b.likes || 0) - (a.likes || 0) || (a.dislikes || 0) - (b.dislikes || 0) || a.name.localeCompare(b.name, 'ko'));
    for (const p of rows) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.id = p.naver_id;
      btn.className = state.selected?.naver_id === p.naver_id ? 'is-selected' : '';
      const badge = p.survey === 'yes' ? '<span class="badge yes">가능</span>' : p.survey === 'no' ? '<span class="badge no">불가능</span>' : '<span class="badge none">미조사</span>';
      const dist = state.me ? `<span class="p-dist">${fmtDist(distanceTo(p))}</span>` : '';
      const likes = p.likes ? `<span class="p-likes">👍 ${p.likes}</span>` : '';
      btn.innerHTML = `<span class="p-name">${esc(p.name)}<span class="p-cat">${esc(p.category || '')}</span>${likes}</span>${badge}<span class="p-addr">${dist}${esc(p.road_address || p.address || '')}</span>`;
      btn.addEventListener('click', () => select(p, true));
      li.appendChild(btn);
      el.list.appendChild(li);
    }
  }

  el.chips.addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    if (chip.dataset.sort) {
      // 정렬 칩(가까운 순 / 좋아요 순)은 하나만 켜진다. 다시 누르면 꺼진다.
      const kind = chip.dataset.sort;
      const turnOn = state.sort !== kind;
      const apply = (on) => {
        state.sort = on ? kind : null;
        for (const c of el.chips.querySelectorAll('.chip[data-sort]')) c.classList.toggle('is-active', c.dataset.sort === state.sort);
        renderList();
      };
      if (turnOn && kind === 'near' && !state.me) locate((ok) => apply(ok));   // 가까운 순은 내 위치가 있어야 한다
      else apply(turnOn);
      return;
    }
    state.filter = chip.dataset.filter;
    for (const c of el.chips.querySelectorAll('.chip[data-filter]')) c.classList.toggle('is-active', c === chip);
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
    el.sheetDist.textContent = state.me ? `내 위치에서 ${fmtDist(distanceTo(p))}` : '';
    el.likeCount.textContent = p.likes || 0;
    el.dislikeCount.textContent = p.dislikes || 0;
    const mine = myReactions[p.naver_id] || null;
    el.btnLike.classList.toggle('is-on', mine === 'like');
    el.btnDislike.classList.toggle('is-on', mine === 'dislike');
  }

  // ---------- 좋아요 / 싫어요 ----------
  // 로그인이 없으므로 브라우저마다 임의의 device_id 를 만들어 기기당 하나만 센다. 내가 누른 것은 브라우저에 기억한다.
  const deviceId = localStorage.getItem('deviceId') || (() => { const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()); localStorage.setItem('deviceId', id); return id; })();
  const myReactions = JSON.parse(localStorage.getItem('myReactions') || '{}');
  async function react(kind) {
    const p = state.selected;
    if (!p) return;
    const next = myReactions[p.naver_id] === kind ? null : kind;   // 같은 것을 다시 누르면 취소
    const before = { mine: myReactions[p.naver_id] || null, likes: p.likes || 0, dislikes: p.dislikes || 0 };
    // 화면 먼저
    p.likes = before.likes - (before.mine === 'like') + (next === 'like');
    p.dislikes = before.dislikes - (before.mine === 'dislike') + (next === 'dislike');
    if (next) myReactions[p.naver_id] = next; else delete myReactions[p.naver_id];
    localStorage.setItem('myReactions', JSON.stringify(myReactions));
    renderSheet(p); renderList();
    try {
      const counts = await api('/api/places/' + encodeURIComponent(p.naver_id) + '/reaction', { method: 'PUT', body: JSON.stringify({ device_id: deviceId, kind: next }) });
      p.likes = counts.likes; p.dislikes = counts.dislikes;
      renderSheet(p); renderList();
    } catch (e) {
      p.likes = before.likes; p.dislikes = before.dislikes;
      if (before.mine) myReactions[p.naver_id] = before.mine; else delete myReactions[p.naver_id];
      localStorage.setItem('myReactions', JSON.stringify(myReactions));
      renderSheet(p); renderList();
      alert('저장하지 못했습니다: ' + e.message);
    }
  }
  el.btnLike.addEventListener('click', () => react('like'));
  el.btnDislike.addEventListener('click', () => react('dislike'));
  // 네이버 지도 길찾기(도보)를 새 탭으로 연다. 내 위치가 있으면 출발지로 넣는다.
  function routeUrl(p) {
    const goal = `${p.lng},${p.lat},${encodeURIComponent(p.name)}`;
    const start = state.me ? `${state.me.lng},${state.me.lat},${encodeURIComponent('내위치')}` : '-';
    return `https://map.naver.com/p/directions/${start}/${goal}/-/walk`;
  }
  el.route.addEventListener('click', () => {
    const p = state.selected;
    if (!p) return;
    if (state.me) return window.open(routeUrl(p), '_blank');
    locate(() => window.open(routeUrl(p), '_blank'));   // 위치를 못 얻어도 도착지만 넣어서 연다
  });
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
  else goHome();
  window.addEventListener('hashchange', () => {
    const mm = location.hash.match(/#r=(\d+)/);
    if (mm && Number(mm[1]) !== state.regionId) openRegion(Number(mm[1]), hashQuery());
    if (!mm) goHome();
  });
})();
