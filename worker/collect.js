import { MESSAGES } from '../lib/messages.js';
import { bboxOfFeature, pointInGeometry } from '../lib/geo.js';
import { regionScript, placesScript } from './scripts.js';
import { createAgent } from './agent.js';

// 네이버 검색 결과(adm 폴리곤 또는 develope 후보 목록)에서 쓸 구획 하나를 정한다.
export async function pickPolygon(r, rawQuery, agent, log) {
  if (!r || r.error === 'no_polygon') return null;
  if (r.feature) return { kind: r.kind, key: r.key, name: r.name, feature: r.feature };
  if (Array.isArray(r.candidates) && r.candidates.length) {
    const { index, reason } = await agent.chooseCandidate(rawQuery, r.candidates);
    const c = r.candidates[index];
    const feature = r.features?.[c.id] ?? null;
    if (reason) log(`agent chose "${c.name}": ${reason}`);
    if (!feature) return null;
    return { kind: r.kind, key: String(c.id), name: c.name, feature };
  }
  return null;
}

export async function collectRegion(repo, region, { runRepl, log = () => {}, agent = createAgent({ log }) }) {
  try {
    const ai = await agent.interpretQuery(region.query);
    if (ai.query !== region.query || ai.note) {
      await repo.setRegionAi(region.id, { search_query: ai.query, ai_note: ai.note });
      log(`agent: "${region.query}" → "${ai.query}"${ai.note ? ' (' + ai.note + ')' : ''}`);
    }
    const r = await pickPolygon(await runRepl(regionScript(ai.query)), region.query, agent, log);
    if (!r) {
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
      const suggestions = await agent.suggestNarrower(region.query, r.name);
      await repo.failRegion(region.id, MESSAGES.TOO_WIDE, { suggestions });
      if (suggestions.length) log(`agent suggests: ${suggestions.join(' / ')}`);
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
