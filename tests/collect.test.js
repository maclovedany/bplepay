import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionScript, placesScript } from '../worker/scripts.js';
import { collectRegion } from '../worker/collect.js';
import { MESSAGES } from '../lib/messages.js';

const square = { type: 'Feature', bbox: [0, 0, 10, 10], geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } };
const region = { id: 42, query: '동성로' };

function fakeRepo({ existing = null } = {}) {
  const calls = [];
  const rec = (name) => async (...args) => { calls.push([name, ...args]); };
  return {
    calls,
    failRegion: rec('failRegion'), mergeRegion: rec('mergeRegion'), setRegionPolygon: rec('setRegionPolygon'),
    upsertPlaces: rec('upsertPlaces'), linkPlaces: rec('linkPlaces'), markReady: rec('markReady'), upsertAlias: rec('upsertAlias'),
    async findRegionBySourceKey(key) { calls.push(['findRegionBySourceKey', key]); return existing; },
  };
}

// 스크립트 문자열에 api/polygon 이 들어 있으면 구획 호출, 아니면 식당 호출로 본다.
function fakeRunRepl({ region: r, places: p }) {
  const scripts = [];
  const fn = async (script) => { scripts.push(script); return /api\/polygon/.test(script) ? r : p; };
  fn.scripts = scripts;
  return fn;
}

test('no_polygon → failRegion with NO_POLYGON', async () => {
  const repo = fakeRepo();
  await collectRegion(repo, region, { runRepl: fakeRunRepl({ region: { error: 'no_polygon' } }) });
  assert.deepEqual(repo.calls, [['failRegion', 42, MESSAGES.NO_POLYGON]]);
});

test('existing source_key → mergeRegion, no places call', async () => {
  const repo = fakeRepo({ existing: { id: 7, status: 'ready' } });
  const runRepl = fakeRunRepl({ region: { kind: 'develope', key: '3696089', name: '동성로로데오거리', feature: square } });
  await collectRegion(repo, region, { runRepl });
  assert.deepEqual(repo.calls, [['findRegionBySourceKey', 'develope:3696089'], ['mergeRegion', 42, 7, '동성로']]);
  assert.equal(runRepl.scripts.length, 1);
});

test('too_wide → failRegion with TOO_WIDE', async () => {
  const repo = fakeRepo();
  const runRepl = fakeRunRepl({ region: { kind: 'adm', key: '06110545', name: '삼덕동', feature: square }, places: { error: 'too_wide' } });
  await collectRegion(repo, region, { runRepl });
  assert.deepEqual(repo.calls.at(-1), ['failRegion', 42, MESSAGES.TOO_WIDE]);
  assert.equal(repo.calls.some((c) => c[0] === 'markReady'), false);
});

test('happy path filters outside points, dedupes, marks ready, aliases', async () => {
  const repo = fakeRepo();
  const items = [
    { naver_id: 'a', name: 'A', category: '한식', road_address: 'r', address: 'x', phone: null, lng: 5, lat: 5 },
    { naver_id: 'a', name: 'A', category: '한식', road_address: 'r', address: 'x', phone: null, lng: 5, lat: 5 },
    { naver_id: 'b', name: 'B', category: '카페', road_address: 'r', address: 'x', phone: null, lng: 50, lat: 50 },
  ];
  const runRepl = fakeRunRepl({ region: { kind: 'adm', key: '06110545', name: '삼덕동', feature: square }, places: { items, leaves: 1 } });
  await collectRegion(repo, region, { runRepl });
  const names = repo.calls.map((c) => c[0]);
  assert.deepEqual(names, ['findRegionBySourceKey', 'setRegionPolygon', 'upsertPlaces', 'linkPlaces', 'markReady', 'upsertAlias']);
  assert.deepEqual(repo.calls[1][2], { source_kind: 'adm', source_key: 'adm:06110545', source_name: '삼덕동', polygon: square.geometry, bbox: [0, 0, 10, 10], name: '동성로' });
  assert.deepEqual(repo.calls[2][1].map((p) => p.naver_id), ['a']);
  assert.deepEqual(repo.calls[3], ['linkPlaces', 42, ['a']]);
  assert.deepEqual(repo.calls[5], ['upsertAlias', '동성로', 42]);
});

test('thrown error → failRegion with 수집 중 오류', async () => {
  const repo = fakeRepo();
  await collectRegion(repo, region, { runRepl: async () => { throw new Error('aside repl failed: boom'); } });
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
  assert.ok(s.includes('24'));
  assert.ok(s.includes('restaurant/list'));
  assert.ok(s.includes('display=100'));
  assert.ok(s.includes('function parseApolloState'));
});

// ---- 리뷰 반영: 같은 구획이 failed/collecting 으로 남아 있을 때 ----
test('existing failed region with same source_key → fail with its error, no polygon write', async () => {
  const repo = fakeRepo({ existing: { id: 7, status: 'failed', error: MESSAGES.TOO_WIDE } });
  const runRepl = fakeRunRepl({ region: { kind: 'adm', key: '04150109', name: '교동', feature: square } });
  await collectRegion(repo, region, { runRepl });
  assert.deepEqual(repo.calls, [['findRegionBySourceKey', 'adm:04150109'], ['failRegion', 42, MESSAGES.TOO_WIDE]]);
  assert.equal(runRepl.scripts.length, 1);
});

test('existing collecting region with same source_key → merge', async () => {
  const repo = fakeRepo({ existing: { id: 7, status: 'collecting' } });
  const runRepl = fakeRunRepl({ region: { kind: 'adm', key: '06110545', name: '삼덕동', feature: square } });
  await collectRegion(repo, region, { runRepl });
  assert.deepEqual(repo.calls[1], ['mergeRegion', 42, 7, '동성로']);
});
