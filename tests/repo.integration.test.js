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
  assert.equal(r.status, 'collecting');
  assert.equal((await repo.nextCollecting()).id <= r.id, true);

  await repo.setRegionPolygon(r.id, {
    source_kind: 'adm', source_key: 'adm:test' + Date.now(), source_name: 'T',
    polygon: { type: 'Polygon', coordinates: [] }, bbox: [0, 0, 1, 1], name: 'T',
  });
  const withPoly = await repo.getRegion(r.id);
  assert.equal(withPoly.source_kind, 'adm');
  assert.deepEqual(withPoly.bbox, [0, 0, 1, 1]);
  assert.equal(await repo.findRegionBySourceKey(withPoly.source_key), null, 'not ready yet');

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

  await repo.failRegion(r2.id, 'oops');
  assert.equal((await repo.getRegion(r2.id)).error, 'oops');
  await repo.resetToCollecting(r2.id);
  assert.equal((await repo.getRegion(r2.id)).status, 'collecting');
  assert.equal((await repo.getRegion(r2.id)).error, null);
  assert.deepEqual(await repo.staleCollecting(0), (await repo.staleCollecting(0)).filter(() => true));

  await repo.deleteRegion(r2.id);
  await repo.deleteRegion(r.id);
  assert.equal(await repo.getRegion(r.id), null);
  assert.equal(await repo.findAlias(q), null);
});
