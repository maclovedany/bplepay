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

// 조사원이 업종을 원했으면("한식집") 그 지역 업종 중 맞는 것들을 골라 별칭에 붙일 필터를 만든다.
async function categoryFilter(agent, want, getCategories) {
  if (!want || !agent.matchCategories) return null;
  const categories = await agent.matchCategories(want, await getCategories());
  return { want, categories };
}

const MAX_PLACE_CALLS = 4;

// 식당 목록을 모은다. 한 번의 REPL 호출이 시간 예산 안에 다 못 보면 남은 상자(pending)로 이어서 호출한다.
// MAX_PLACE_CALLS 번 뒤에도 남으면 너무 넓은 것으로 보고 null 을 돌려준다.
export async function collectPlaces(runRepl, bbox, log = () => {}) {
  const items = [];
  let leaves = 0;
  let pending = [bbox];
  for (let call = 1; call <= MAX_PLACE_CALLS && pending.length; call++) {
    const p = await runRepl(placesScript(pending));
    if (!p || p.error) return null;
    items.push(...(p.items ?? []));
    leaves += p.leaves ?? 0;
    pending = p.pending ?? [];
    if (pending.length) log(`places call ${call}: ${leaves} leaves so far, ${pending.length} boxes pending`);
  }
  if (pending.length) return null;
  return { items, leaves };
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
      const filter = await categoryFilter(agent, ai.want, () => repo.getRegionCategories(existing.id));
      if (filter) await repo.mergeRegion(region.id, existing.id, region.query, filter);
      else await repo.mergeRegion(region.id, existing.id, region.query);
      log(`merged into #${existing.id} (${r.name})${filter ? ', filter ' + filter.categories.join('/') : ''}`);
      return;
    }
    const bbox = bboxOfFeature(r.feature);
    await repo.setRegionPolygon(region.id, { source_kind: r.kind, source_key, source_name: r.name, polygon: r.feature.geometry, bbox, name: region.query });
    log(`polygon ${r.kind}:${r.key} ${r.name}, bbox ${bbox.map((n) => n.toFixed(4)).join(',')}`);

    const p = await collectPlaces(runRepl, bbox, log);
    if (!p) {
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
    // 식당이 아닌 업종(미용실, 학원 …)은 AI 가 골라 뺀다.
    const cats = [...new Set(inside.map((i) => i.category).filter(Boolean))];
    const exclude = new Set((await agent.excludeNonFood?.(cats)) ?? []);
    const kept = exclude.size ? inside.filter((i) => !exclude.has(i.category)) : inside;
    if (exclude.size) {
      await repo.setRegionAi(region.id, { ai_excluded: { categories: [...exclude], count: inside.length - kept.length } });
      log(`agent excluded ${inside.length - kept.length} places in ${exclude.size} categories: ${[...exclude].join('/')}`);
    }
    await repo.upsertPlaces(kept);
    await repo.linkPlaces(region.id, kept.map((i) => i.naver_id));
    await repo.markReady(region.id);
    const filter = await categoryFilter(agent, ai.want, async () => [...new Set(kept.map((i) => i.category).filter(Boolean))]);
    if (filter) await repo.upsertAlias(region.query, region.id, filter);
    else await repo.upsertAlias(region.query, region.id);
    log(`ready: ${kept.length} places inside of ${seen.size} fetched (${p.leaves} leaves)${filter ? ', filter ' + filter.categories.join('/') : ''}`);
  } catch (e) {
    await repo.failRegion(region.id, ('수집 중 오류: ' + (e?.message ?? String(e))).slice(0, 220));
  }
}
