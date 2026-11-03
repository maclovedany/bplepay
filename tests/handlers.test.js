import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandlers } from '../api/_handlers.js';
import { MESSAGES } from '../lib/messages.js';

function fakeRepo(seed = {}) {
  const regions = new Map(Object.entries(seed.regions ?? {}).map(([k, v]) => [Number(k), v]));
  const aliases = new Map(Object.entries(seed.aliases ?? {}));
  const calls = [];
  let nextId = 100;
  return {
    calls, regions,
    async findAlias(q) { return aliases.has(q) ? { region_id: aliases.get(q) } : null; },
    async findRegionByQuery(q) { return [...regions.values()].find((r) => r.query === q) ?? null; },
    async createRegion({ query, name }) { const r = { id: nextId++, query, name, status: 'collecting', created_at: new Date().toISOString() }; regions.set(r.id, r); calls.push(['createRegion', query]); return r; },
    async getRegion(id) { return regions.get(Number(id)) ?? null; },
    async listRegions() { return [...regions.values()].filter((r) => r.status !== 'merged'); },
    async resetToCollecting(id) { calls.push(['resetToCollecting', id]); Object.assign(regions.get(id), { status: 'collecting', error: null }); },
    async failRegion(id, error) { calls.push(['failRegion', id, error]); Object.assign(regions.get(Number(id)), { status: 'failed', error }); },
    async getRegionPlaces(id) { return seed.places?.[id] ?? []; },
    async setSurvey(naverId, status) { calls.push(['setSurvey', naverId, status]); },
    async deleteRegion(id) { calls.push(['deleteRegion', Number(id)]); regions.delete(Number(id)); },
    async statsInput() { return seed.stats ?? { regions: [], links: [], surveys: [] }; },
  };
}

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.status = (n) => { res.statusCode = n; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  return res;
}

test('POST empty query → 400', async () => {
  const repo = fakeRepo(); const h = createHandlers(repo); const res = fakeRes();
  await h.regionsCreate({ method: 'POST', body: { query: '  ' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(repo.calls.length, 0);
});

test('POST known alias returns existing', async () => {
  const repo = fakeRepo({ aliases: { '동성로': 7 }, regions: { 7: { id: 7, query: '동성로', status: 'ready' } } });
  const res = fakeRes();
  await createHandlers(repo).regionsCreate({ method: 'POST', body: { query: ' 동성로 ' } }, res);
  assert.deepEqual(res.body, { id: 7, status: 'ready' });
});

test('POST failed region resets to collecting', async () => {
  const repo = fakeRepo({ regions: { 3: { id: 3, query: '교동', status: 'failed', error: 'x' } } });
  const res = fakeRes();
  await createHandlers(repo).regionsCreate({ method: 'POST', body: { query: '교동' } }, res);
  assert.deepEqual(res.body, { id: 3, status: 'collecting' });
  assert.deepEqual(repo.calls, [['resetToCollecting', 3]]);
});

test('POST new query creates region', async () => {
  const repo = fakeRepo(); const res = fakeRes();
  await createHandlers(repo).regionsCreate({ method: 'POST', body: { query: '삼덕동' } }, res);
  assert.deepEqual(res.body, { id: 100, status: 'collecting' });
});

test('GET stale collecting becomes failed with WORKER_DOWN', async () => {
  const created = Date.parse('2026-11-03T00:00:00Z');
  const repo = fakeRepo({ regions: { 5: { id: 5, query: 'x', name: 'x', status: 'collecting', created_at: new Date(created).toISOString() } } });
  const res = fakeRes();
  await createHandlers(repo, { now: () => created + 4 * 60000 }).regionGet({ method: 'GET', query: { id: '5' } }, res);
  assert.equal(res.body.region.status, 'failed');
  assert.equal(res.body.region.error, MESSAGES.WORKER_DOWN);
  assert.deepEqual(repo.calls, [['failRegion', 5, MESSAGES.WORKER_DOWN]]);
});

test('GET fresh collecting stays collecting', async () => {
  const created = Date.now();
  const repo = fakeRepo({ regions: { 5: { id: 5, query: 'x', name: 'x', status: 'collecting', created_at: new Date(created).toISOString() } } });
  const res = fakeRes();
  await createHandlers(repo, { now: () => created + 60000 }).regionGet({ method: 'GET', query: { id: '5' } }, res);
  assert.equal(res.body.region.status, 'collecting');
  assert.equal(res.body.places, undefined);
});

test('GET merged region follows merged_into and includes places', async () => {
  const repo = fakeRepo({
    regions: { 1: { id: 1, name: '동성로', status: 'ready', polygon: { type: 'Polygon', coordinates: [] }, bbox: [0, 0, 1, 1], source_name: 'S' }, 2: { id: 2, status: 'merged', merged_into: 1 } },
    places: { 1: [{ naver_id: 'a', name: 'A', survey: 'yes' }] },
  });
  const res = fakeRes();
  await createHandlers(repo).regionGet({ method: 'GET', query: { id: '2' } }, res);
  assert.equal(res.body.region.id, 1);
  assert.equal(res.body.region.source_name, 'S');
  assert.deepEqual(res.body.places, [{ naver_id: 'a', name: 'A', survey: 'yes' }]);
});

test('GET unknown region → 404', async () => {
  const res = fakeRes();
  await createHandlers(fakeRepo()).regionGet({ method: 'GET', query: { id: '9' } }, res);
  assert.equal(res.statusCode, 404);
});

test('GET regions list includes stats per region', async () => {
  const repo = fakeRepo({ regions: { 1: { id: 1, name: '동성로', status: 'ready', created_at: 't' } },
    stats: { regions: [{ id: 1, name: '동성로' }], links: [{ region_id: 1, naver_id: 'a' }], surveys: [{ naver_id: 'a', status: 'yes' }] } });
  const res = fakeRes();
  await createHandlers(repo).regionsList({ method: 'GET' }, res);
  assert.equal(res.body.regions[0].stats.yes, 1);
});

test('DELETE region', async () => {
  const repo = fakeRepo({ regions: { 4: { id: 4 } } }); const res = fakeRes();
  await createHandlers(repo).regionDelete({ method: 'DELETE', query: { id: '4' } }, res);
  assert.deepEqual(res.body, { ok: true });
  assert.deepEqual(repo.calls, [['deleteRegion', 4]]);
});

test('PUT survey rejects "maybe"', async () => {
  const repo = fakeRepo(); const res = fakeRes();
  await createHandlers(repo).surveyPut({ method: 'PUT', query: { naverId: 'a' }, body: { status: 'maybe' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(repo.calls.length, 0);
});

test('PUT survey accepts yes and null', async () => {
  const repo = fakeRepo();
  await createHandlers(repo).surveyPut({ method: 'PUT', query: { naverId: 'a' }, body: { status: 'yes' } }, fakeRes());
  await createHandlers(repo).surveyPut({ method: 'PUT', query: { naverId: 'a' }, body: { status: null } }, fakeRes());
  assert.deepEqual(repo.calls, [['setSurvey', 'a', 'yes'], ['setSurvey', 'a', null]]);
});

test('GET stats csv sets headers', async () => {
  const res = fakeRes();
  await createHandlers(fakeRepo()).statsGet({ method: 'GET', query: { format: 'csv' } }, res);
  assert.equal(res.headers['content-type'], 'text/csv; charset=utf-8');
  assert.equal(res.headers['content-disposition'], 'attachment; filename="bple-stats.csv"');
  assert.ok(res.body.startsWith('﻿'));
});

test('GET stats json', async () => {
  const res = fakeRes();
  await createHandlers(fakeRepo()).statsGet({ method: 'GET', query: {} }, res);
  assert.equal(res.body.all.name, '합계');
});

// ---- 리뷰 반영: 재시도·대기열·병합 대상 삭제 ----
test('GET collecting that the worker has started stays collecting even past 3 minutes', async () => {
  const created = Date.parse('2026-11-03T00:00:00Z');
  const repo = fakeRepo({ regions: { 5: { id: 5, query: 'x', name: 'x', status: 'collecting', created_at: new Date(created).toISOString(), started_at: new Date(created + 3.5 * 60000).toISOString() } } });
  const res = fakeRes();
  await createHandlers(repo, { now: () => created + 4 * 60000 }).regionGet({ method: 'GET', query: { id: '5' } }, res);
  assert.equal(res.body.region.status, 'collecting');
  assert.equal(repo.calls.length, 0);
});

test('GET collecting started more than 5 minutes ago → failed with timeout error', async () => {
  const created = Date.parse('2026-11-03T00:00:00Z');
  const repo = fakeRepo({ regions: { 5: { id: 5, query: 'x', name: 'x', status: 'collecting', created_at: new Date(created).toISOString(), started_at: new Date(created + 60000).toISOString() } } });
  const res = fakeRes();
  await createHandlers(repo, { now: () => created + 7 * 60000 }).regionGet({ method: 'GET', query: { id: '5' } }, res);
  assert.equal(res.body.region.status, 'failed');
  assert.match(res.body.region.error, /^수집 중 오류: 시간 초과/);
});

test('POST query whose merged target was deleted resets it to collecting', async () => {
  const repo = fakeRepo({ regions: { 3: { id: 3, query: '삼덕동', status: 'merged', merged_into: null } } });
  const res = fakeRes();
  await createHandlers(repo).regionsCreate({ method: 'POST', body: { query: '삼덕동' } }, res);
  assert.deepEqual(res.body, { id: 3, status: 'collecting' });
  assert.deepEqual(repo.calls, [['resetToCollecting', 3]]);
});

test('GET merged region whose target was deleted → 404 with message', async () => {
  const repo = fakeRepo({ regions: { 3: { id: 3, query: '삼덕동', status: 'merged', merged_into: null } } });
  const res = fakeRes();
  await createHandlers(repo).regionGet({ method: 'GET', query: { id: '3' } }, res);
  assert.equal(res.statusCode, 404);
});

test('GET with non-numeric id → 400', async () => {
  const res = fakeRes();
  await createHandlers(fakeRepo()).regionGet({ method: 'GET', query: { id: 'abc' } }, res);
  assert.equal(res.statusCode, 400);
});

test('GET region exposes search_query, ai_note and suggestions', async () => {
  const repo = fakeRepo({ regions: { 1: { id: 1, name: '교동', status: 'failed', error: 'x', search_query: '대구 중구 교동', ai_note: '시·구를 붙임', suggestions: ['대구 중구 교동'] } } });
  const res = fakeRes();
  await createHandlers(repo).regionGet({ method: 'GET', query: { id: '1' } }, res);
  assert.equal(res.body.region.search_query, '대구 중구 교동');
  assert.equal(res.body.region.ai_note, '시·구를 붙임');
  assert.deepEqual(res.body.region.suggestions, ['대구 중구 교동']);
});
