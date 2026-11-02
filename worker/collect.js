import { MESSAGES } from '../lib/messages.js';
import { bboxOfFeature, pointInGeometry } from '../lib/geo.js';
import { regionScript, placesScript } from './scripts.js';

export async function collectRegion(repo, region, { runRepl, log = () => {} }) {
  try {
    const r = await runRepl(regionScript(region.query));
    if (!r || r.error === 'no_polygon' || !r.feature) {
      await repo.failRegion(region.id, MESSAGES.NO_POLYGON);
      return;
    }
    const source_key = r.kind + ':' + r.key;
    const existing = await repo.findRegionBySourceKey(source_key);
    if (existing && existing.status === 'failed') {
      // 같은 구획이 이미 실패한 적이 있으면 같은 이유로 실패시킨다 (유니크 키 충돌 방지).
      await repo.failRegion(region.id, existing.error || MESSAGES.NO_POLYGON);
      return;
    }
    if (existing) {
      await repo.mergeRegion(region.id, existing.id, region.query);
      log(`merged into #${existing.id} (${r.name})`);
      return;
    }
    const bbox = bboxOfFeature(r.feature);
    await repo.setRegionPolygon(region.id, { source_kind: r.kind, source_key, source_name: r.name, polygon: r.feature.geometry, bbox, name: region.query });
    log(`polygon ${r.kind}:${r.key} ${r.name}, bbox ${bbox.map((n) => n.toFixed(4)).join(',')}`);

    const p = await runRepl(placesScript(bbox));
    if (!p || p.error === 'too_wide') {
      await repo.failRegion(region.id, MESSAGES.TOO_WIDE);
      return;
    }
    const seen = new Set();
    const inside = [];
    for (const it of p.items ?? []) {
      if (seen.has(it.naver_id)) continue;
      seen.add(it.naver_id);
      if (pointInGeometry([it.lng, it.lat], r.feature.geometry)) inside.push(it);
    }
    await repo.upsertPlaces(inside);
    await repo.linkPlaces(region.id, inside.map((i) => i.naver_id));
    await repo.markReady(region.id);
    await repo.upsertAlias(region.query, region.id);
    log(`ready: ${inside.length} places inside of ${seen.size} fetched (${p.leaves} leaves)`);
  } catch (e) {
    await repo.failRegion(region.id, ('수집 중 오류: ' + (e?.message ?? String(e))).slice(0, 220));
  }
}
