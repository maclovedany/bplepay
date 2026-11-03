import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';

const hasEnv = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

test('region lifecycle', { skip: !hasEnv && 'no supabase env' }, async () => {
  const { getDb } = await import('../lib/db.js');
  const { createRepo } = await import('../lib/repo.js');
  const repo = createRepo(getDb());
  const q = '__test__' + Date.now();
  const pid = 'p1' + q;

  const r = await repo.createRegion({ query: q, name: q });
  try {
  assert.equal(r.status, 'collecting');
  assert.equal((await repo.nextCollecting()).id <= r.id, true);

  await repo.setRegionPolygon(r.id, {
    source_kind: 'adm', source_key: 'adm:test' + Date.now(), source_name: 'T',
    polygon: { type: 'Polygon', coordinates: [] }, bbox: [0, 0, 1, 1], name: 'T',
  });
  const withPoly = await repo.getRegion(r.id);
  assert.equal(withPoly.source_kind, 'adm');
  assert.deepEqual(withPoly.bbox, [0, 0, 1, 1]);
  assert.equal((await repo.findRegionBySourceKey(withPoly.source_key)).id, r.id, 'found even while collecting (same-polygon requests merge instead of colliding)');

  await repo.upsertPlaces([{ naver_id: pid, name: '식당', category: '한식', road_address: 'x', address: 'y', phone: null, lng: 0.5, lat: 0.5 }]);
  await repo.linkPlaces(r.id, [pid]);
  await repo.linkPlaces(r.id, [pid]); // duplicate link ignored
  await repo.markReady(r.id);
  await repo.upsertAlias(q, r.id);
  assert.equal((await repo.findAlias(q)).region_id, r.id);
  assert.equal((await repo.findRegionBySourceKey(withPoly.source_key)).id, r.id);
  assert.equal((await repo.findRegionByQuery(q)).id, r.id);
  assert.ok((await repo.listRegions()).some((x) => x.id === r.id && x.polygon === undefined));

  await repo.setSurvey(pid, 'yes');
  assert.equal((await repo.getRegionPlaces(r.id))[0].survey, 'yes');
  const si = await repo.statsInput();
  assert.ok(si.links.some((l) => l.region_id === r.id && l.naver_id === pid));
  assert.ok(si.surveys.some((s) => s.naver_id === pid && s.status === 'yes'));
  await repo.setSurvey(pid, null);
  assert.equal((await repo.getRegionPlaces(r.id))[0].survey, null);

  const r2 = await repo.createRegion({ query: q + 'b', name: q + 'b' });
  await repo.mergeRegion(r2.id, r.id, q + 'b');
  assert.equal((await repo.getRegion(r2.id)).status, 'merged');
  assert.equal((await repo.getRegion(r2.id)).merged_into, r.id);
  assert.equal((await repo.findAlias(q + 'b')).region_id, r.id);

  await repo.setRegionAi(r2.id, { search_query: '대구 중구 교동', ai_note: '시·구를 붙임' });
  assert.equal((await repo.getRegion(r2.id)).search_query, '대구 중구 교동');
  await repo.failRegion(r2.id, 'oops', { suggestions: ['a', 'b'] });
  assert.equal((await repo.getRegion(r2.id)).error, 'oops');
  assert.deepEqual((await repo.getRegion(r2.id)).suggestions, ['a', 'b']);
  const beforeReset = (await repo.getRegion(r2.id)).created_at;
  await new Promise((res) => setTimeout(res, 1100));
  await repo.resetToCollecting(r2.id);
  const afterReset = await repo.getRegion(r2.id);
  assert.equal(afterReset.status, 'collecting');
  assert.equal(afterReset.error, null);
  assert.equal(afterReset.started_at, null);
  assert.equal(afterReset.suggestions, null, 'reset clears suggestions');
  assert.ok(Date.parse(afterReset.created_at) > Date.parse(beforeReset), 'resetToCollecting refreshes created_at');
  await repo.markStarted(r2.id);
  assert.ok((await repo.getRegion(r2.id)).started_at, 'markStarted sets started_at');

  // PostgREST 1,000행 상한을 넘겨도 전부 읽는다
  const many = Array.from({ length: 1205 }, (_, i) => ({ naver_id: `m${i}${q}`, name: 'm', category: null, road_address: null, address: null, phone: null, lng: 0.1, lat: 0.1 }));
  await repo.upsertPlaces(many);
  await repo.linkPlaces(r.id, many.map((m) => m.naver_id));
  assert.equal((await repo.getRegionPlaces(r.id)).length, 1206);
  const si2 = await repo.statsInput();
  assert.equal(si2.links.filter((l) => l.region_id === r.id).length, 1206);
  } finally {
    const r2 = await repo.findRegionByQuery(q + 'b');
    if (r2) await repo.deleteRegion(r2.id);
    await repo.deleteRegion(r.id);
    const db = getDb();
    await db.from('surveys').delete().like('naver_id', '%' + q);
    await db.from('places').delete().like('naver_id', '%' + q);
  }
  assert.equal(await repo.getRegion(r.id), null);
  assert.equal(await repo.findAlias(q), null);
});
