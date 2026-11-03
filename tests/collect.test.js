import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionScript, placesScript } from '../worker/scripts.js';
import { collectRegion } from '../worker/collect.js';
import { MESSAGES } from '../lib/messages.js';

const square = { type: 'Feature', bbox: [0, 0, 10, 10], geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } };
const region = { id: 42, query: '동성로' };
const noAgent = { async interpretQuery(q) { return { query: q, note: null }; }, async chooseCandidate() { return { index: 0, reason: null }; }, async suggestNarrower() { return []; } };

function fakeRepo({ existing = null } = {}) {
  const calls = [];
  const rec = (name) => async (...args) => { calls.push([name, ...args]); };
  return {
    calls,
    failRegion: rec('failRegion'), mergeRegion: rec('mergeRegion'), setRegionPolygon: rec('setRegionPolygon'),
    upsertPlaces: rec('upsertPlaces'), linkPlaces: rec('linkPlaces'), markReady: rec('markReady'), upsertAlias: rec('upsertAlias'), setRegionAi: rec('setRegionAi'),
    async findRegionBySourceKey(key) { calls.push(['findRegionBySourceKey', key]); return existing; },
  };
}

// 스크립트 문자열에 api/polygon 이 들어 있으면 구획 호출, 아니면 식당 호출로 본다.
function fakeRunRepl({ region: r, places: p }) {
  const scripts = [];
  const fn = async (script) => { scripts.push(script); return /api\/polygon/.test(script) ? r : (Array.isArray(p) ? p.shift() : p); };
  fn.scripts = scripts;
  return fn;
}

test('no_polygon → failRegion with NO_POLYGON', async () => {
  const repo = fakeRepo();
  await collectRegion(repo, region, { runRepl: fakeRunRepl({ region: { error: 'no_polygon' } }), agent: noAgent });
  assert.deepEqual(repo.calls, [['failRegion', 42, MESSAGES.NO_POLYGON]]);
});

test('existing source_key → mergeRegion, no places call', async () => {
  const repo = fakeRepo({ existing: { id: 7, status: 'ready' } });
  const runRepl = fakeRunRepl({ region: { kind: 'develope', key: '3696089', name: '동성로로데오거리', feature: square } });
  await collectRegion(repo, region, { runRepl, agent: noAgent });
  assert.deepEqual(repo.calls, [['findRegionBySourceKey', 'develope:3696089'], ['mergeRegion', 42, 7, '동성로']]);
  assert.equal(runRepl.scripts.length, 1);
});

test('too_wide → failRegion with TOO_WIDE', async () => {
  const repo = fakeRepo();
  const runRepl = fakeRunRepl({ region: { kind: 'adm', key: '06110545', name: '삼덕동', feature: square }, places: { error: 'too_wide' } });
  await collectRegion(repo, region, { runRepl, agent: noAgent });
  assert.deepEqual(repo.calls.at(-1), ['failRegion', 42, MESSAGES.TOO_WIDE, { suggestions: [] }]);
  assert.equal(repo.calls.some((c) => c[0] === 'markReady'), false);
});

test('places call that returns pending bboxes is continued in a second call', async () => {
  const repo = fakeRepo();
  const a = { naver_id: 'a', name: 'A', category: '한식', road_address: 'r', address: 'x', phone: null, lng: 5, lat: 5 };
  const b = { naver_id: 'b', name: 'B', category: '카페', road_address: 'r', address: 'x', phone: null, lng: 6, lat: 6 };
  const runRepl = fakeRunRepl({ region: { kind: 'adm', key: '06110545', name: '삼덕동', feature: square }, places: [
    { items: [a], leaves: 3, pending: [[0, 0, 5, 5], [5, 5, 10, 10]] },
    { items: [b], leaves: 2, pending: [] },
  ] });
  await collectRegion(repo, region, { runRepl, agent: noAgent });
  assert.equal(runRepl.scripts.length, 3);
  assert.ok(runRepl.scripts[2].includes('[[0,0,5,5],[5,5,10,10]]'));
  assert.deepEqual(repo.calls.find((c) => c[0] === 'upsertPlaces')[1].map((i) => i.naver_id), ['a', 'b']);
  assert.ok(repo.calls.some((c) => c[0] === 'markReady'));
});

test('pending bboxes still left after 4 calls → TOO_WIDE', async () => {
  const repo = fakeRepo();
  const more = { items: [], leaves: 1, pending: [[0, 0, 5, 5]] };
  const runRepl = fakeRunRepl({ region: { kind: 'adm', key: '06110545', name: '삼덕동', feature: square }, places: [more, more, more, more, more] });
  await collectRegion(repo, region, { runRepl, agent: noAgent });
  assert.equal(runRepl.scripts.length, 5);
  assert.deepEqual(repo.calls.at(-1), ['failRegion', 42, MESSAGES.TOO_WIDE, { suggestions: [] }]);
});

test('happy path filters outside points, dedupes, marks ready, aliases', async () => {
  const repo = fakeRepo();
  const items = [
    { naver_id: 'a', name: 'A', category: '한식', road_address: 'r', address: 'x', phone: null, lng: 5, lat: 5 },
    { naver_id: 'a', name: 'A', category: '한식', road_address: 'r', address: 'x', phone: null, lng: 5, lat: 5 },
    { naver_id: 'b', name: 'B', category: '카페', road_address: 'r', address: 'x', phone: null, lng: 50, lat: 50 },
  ];
  const runRepl = fakeRunRepl({ region: { kind: 'adm', key: '06110545', name: '삼덕동', feature: square }, places: { items, leaves: 1 } });
  await collectRegion(repo, region, { runRepl, agent: noAgent });
  const names = repo.calls.map((c) => c[0]);
  assert.deepEqual(names, ['findRegionBySourceKey', 'setRegionPolygon', 'upsertPlaces', 'linkPlaces', 'markReady', 'upsertAlias']);
  assert.deepEqual(repo.calls[1][2], { source_kind: 'adm', source_key: 'adm:06110545', source_name: '삼덕동', polygon: square.geometry, bbox: [0, 0, 10, 10], name: '동성로' });
  assert.deepEqual(repo.calls[2][1].map((p) => p.naver_id), ['a']);
  assert.deepEqual(repo.calls[3], ['linkPlaces', 42, ['a']]);
  assert.deepEqual(repo.calls[5], ['upsertAlias', '동성로', 42]);
});

test('thrown error → failRegion with 수집 중 오류', async () => {
  const repo = fakeRepo();
  await collectRegion(repo, region, { runRepl: async () => { throw new Error('aside repl failed: boom'); }, agent: noAgent });
  assert.equal(repo.calls.length, 1);
  assert.equal(repo.calls[0][0], 'failRegion');
  assert.match(repo.calls[0][2], /^수집 중 오류: aside repl failed: boom/);
});

test('regionScript contains query and adm/develope urls', () => {
  const s = regionScript('동성로');
  assert.ok(s.includes(encodeURIComponent('동성로')));
  assert.ok(s.includes('order=develope'));
  assert.ok(s.includes('order=adm'));
  assert.ok(s.includes('function parseApolloState'));
  assert.ok(s.includes('@@RESULT@@'));
});

test('placesScript embeds bbox and limits', () => {
  const s = placesScript([1, 2, 3, 4]);
  assert.ok(s.includes('[1,2,3,4]'));
  assert.ok(s.includes('100000'));
  assert.ok(s.includes('restaurant/list'));
  assert.ok(s.includes('display=100'));
  assert.ok(s.includes('function parseApolloState'));
  // 잎 하나마다 페이지를 여는 대신 같은 출처에서 fetch 로 HTML 만 받아 파싱한다.
  assert.ok(s.includes('fetch('));
  assert.ok(s.includes('DOMParser'));
  // 예산이 끝나면 남은 상자를 pending 으로 돌려주고, 여러 상자에서 이어서 시작할 수 있다.
  assert.ok(s.includes('pending'));
  assert.ok(placesScript([[1, 2, 3, 4], [5, 6, 7, 8]]).includes('[[1,2,3,4],[5,6,7,8]]'));
});

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
test('generated REPL scripts parse as async JavaScript', () => {
  assert.doesNotThrow(() => new AsyncFunction(regionScript('삼덕동')));
  assert.doesNotThrow(() => new AsyncFunction(placesScript([1, 2, 3, 4])));
});

// ---- 리뷰 반영: 같은 구획이 failed/collecting 으로 남아 있을 때 ----
test('existing failed region with same source_key → fail with its error, no polygon write', async () => {
  const repo = fakeRepo({ existing: { id: 7, status: 'failed', error: MESSAGES.TOO_WIDE } });
  const runRepl = fakeRunRepl({ region: { kind: 'adm', key: '04150109', name: '교동', feature: square } });
  await collectRegion(repo, region, { runRepl, agent: noAgent });
  assert.deepEqual(repo.calls, [['findRegionBySourceKey', 'adm:04150109'], ['failRegion', 42, MESSAGES.TOO_WIDE]]);
  assert.equal(runRepl.scripts.length, 1);
});

test('existing collecting region with same source_key → merge', async () => {
  const repo = fakeRepo({ existing: { id: 7, status: 'collecting' } });
  const runRepl = fakeRunRepl({ region: { kind: 'adm', key: '06110545', name: '삼덕동', feature: square } });
  await collectRegion(repo, region, { runRepl, agent: noAgent });
  assert.deepEqual(repo.calls[1], ['mergeRegion', 42, 7, '동성로']);
});

// ---- AI 판단 층 ----
function fakeAgent({ query = null, note = null, want = null, index = 0, reason = null, suggestions = [] } = {}) {
  const calls = [];
  return {
    calls,
    async interpretQuery(raw) { calls.push(['interpretQuery', raw]); return { query: query ?? raw, note, want }; },
    async chooseCandidate(raw, cands) { calls.push(['chooseCandidate', raw, cands.length]); return { index, reason }; },
    async suggestNarrower(raw, name) { calls.push(['suggestNarrower', raw, name]); return suggestions; },
  };
}

test('agent-rewritten query is what gets searched and is stored with the note', async () => {
  const repo = fakeRepo();
  const runRepl = fakeRunRepl({ region: { kind: 'adm', key: '06110125', name: '교동', feature: square }, places: { items: [], leaves: 1 } });
  const agent = fakeAgent({ query: '대구 중구 교동', note: '시·구를 붙임' });
  await collectRegion(repo, { id: 42, query: '교동' }, { runRepl, agent });
  assert.ok(runRepl.scripts[0].includes(encodeURIComponent('대구 중구 교동')), 'search uses the rewritten query');
  assert.deepEqual(repo.calls[0], ['setRegionAi', 42, { search_query: '대구 중구 교동', ai_note: '시·구를 붙임' }]);
});

test('several polygon candidates → agent picks, chosen one is fetched', async () => {
  const repo = fakeRepo();
  const cands = [{ id: '1', x: 1, y: 1, name: '동성로', category: '거리,골목', address: 'a' }, { id: '3696089', x: 2, y: 2, name: '동성로로데오거리', category: '거리,골목', address: 'b' }];
  const runRepl = fakeRunRepl({ region: { kind: 'develope', candidates: cands, features: { 1: null, 3696089: square } }, places: { items: [], leaves: 1 } });
  const agent = fakeAgent({ index: 1, reason: '먹자골목' });
  await collectRegion(repo, region, { runRepl, agent });
  assert.deepEqual(agent.calls[1], ['chooseCandidate', '동성로', 2]);
  const poly = repo.calls.find((c) => c[0] === 'setRegionPolygon');
  assert.equal(poly[2].source_key, 'develope:3696089');
  assert.equal(poly[2].source_name, '동성로로데오거리');
});

test('too_wide stores agent suggestions with the failure', async () => {
  const repo = fakeRepo();
  const runRepl = fakeRunRepl({ region: { kind: 'adm', key: '06110545', name: '삼덕동', feature: square }, places: { error: 'too_wide' } });
  const agent = fakeAgent({ suggestions: ['대구 중구 삼덕동1가', '대구 중구 삼덕동2가'] });
  await collectRegion(repo, region, { runRepl, agent });
  assert.deepEqual(repo.calls.at(-1), ['failRegion', 42, MESSAGES.TOO_WIDE, { suggestions: ['대구 중구 삼덕동1가', '대구 중구 삼덕동2가'] }]);
});

// ---- 업종 필터 ----
function fakeAgent2(over = {}) {
  const base = fakeAgent(over);
  base.excludeNonFood = async (cats) => { base.calls.push(['excludeNonFood', cats]); return over.exclude ?? []; };
  base.matchCategories = async (want, cats) => { base.calls.push(['matchCategories', want, cats]); return over.matched ?? []; };
  return base;
}
const item = (id, category, lng = 5, lat = 5) => ({ naver_id: id, name: id, category, road_address: 'r', address: 'x', phone: null, lng, lat });

test('non-food categories chosen by the agent are dropped and recorded', async () => {
  const repo = fakeRepo();
  const items = [item('a', '한식'), item('b', '미용실'), item('c', '미용실'), item('d', '카페,디저트')];
  const runRepl = fakeRunRepl({ region: { kind: 'adm', key: '1', name: 'T', feature: square }, places: { items, leaves: 1 } });
  const agent = fakeAgent2({ exclude: ['미용실'] });
  await collectRegion(repo, region, { runRepl, agent });
  assert.deepEqual(agent.calls.find((c) => c[0] === 'excludeNonFood')[1], ['한식', '미용실', '카페,디저트']);
  assert.deepEqual(repo.calls.find((c) => c[0] === 'upsertPlaces')[1].map((p) => p.naver_id), ['a', 'd']);
  assert.deepEqual(repo.calls.find((c) => c[0] === 'setRegionAi')[2].ai_excluded, { categories: ['미용실'], count: 2 });
});

test('wanted category → alias stores want and matched categories', async () => {
  const repo = fakeRepo();
  const items = [item('a', '한식'), item('b', '일식당')];
  const runRepl = fakeRunRepl({ region: { kind: 'adm', key: '1', name: '을지로', feature: square }, places: { items, leaves: 1 } });
  const agent = fakeAgent2({ query: '서울 중구 을지로', note: 'n', want: '한식집', matched: ['한식'] });
  await collectRegion(repo, { id: 42, query: '을지로 근처 한식집' }, { runRepl, agent });
  assert.deepEqual(agent.calls.find((c) => c[0] === 'matchCategories'), ['matchCategories', '한식집', ['한식', '일식당']]);
  assert.deepEqual(repo.calls.at(-1), ['upsertAlias', '을지로 근처 한식집', 42, { want: '한식집', categories: ['한식'] }]);
});

test('merge path with a wanted category computes the filter from the existing region', async () => {
  const repo = fakeRepo({ existing: { id: 7, status: 'ready' } });
  repo.getRegionCategories = async (id) => { repo.calls.push(['getRegionCategories', id]); return ['한식', '카페,디저트']; };
  const runRepl = fakeRunRepl({ region: { kind: 'adm', key: '1', name: '을지로', feature: square } });
  const agent = fakeAgent2({ want: '한식집', matched: ['한식'] });
  await collectRegion(repo, { id: 42, query: '을지로 한식' }, { runRepl, agent });
  assert.deepEqual(repo.calls.at(-1), ['mergeRegion', 42, 7, '을지로 한식', { want: '한식집', categories: ['한식'] }]);
});
