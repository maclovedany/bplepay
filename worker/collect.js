import { MESSAGES } from '../lib/messages.js';
import { bboxOfFeature, pointInGeometry, convexHull } from '../lib/geo.js';
import { regionScript, placesScript } from './scripts.js';
import { createAgent } from './agent.js';
import { createPublicData } from './publicdata.js';

const PUBLIC_RADIUS_M = 1000;   // 공공데이터에서 받아 오는 반경
const PUBLIC_NEAR_M = 300;      // 도로가 아닐 때 남기는 반경

const metersBetween = (a, b) => {
  const dx = (a[0] - b[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180);
  const dy = (a[1] - b[1]) * 110540;
  return Math.hypot(dx, dy);
};

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

// 같은 source_key 를 가진 지역이 이미 있으면 거기에 합친다. 합쳤으면 true.
async function mergeIfExists(repo, region, source_key, name, ai, agent, log) {
  const found = await repo.findRegionBySourceKey(source_key);
  const existing = found && found.id !== region.id ? found : null; // 다시 수집 중인 자기 자신은 제외
  if (!existing) return false;
  if (existing.status === 'failed') {
    // 같은 구획이 예전에 실패한 채 남아 있으면 그 기록에 합치고 다시 수집시킨다.
    // (옛 실패 이유를 그대로 베끼면 수집 코드가 나아져도 영원히 같은 오류가 난다.)
    await repo.mergeRegion(region.id, existing.id, region.query);
    await repo.resetToCollecting(existing.id);
    log(`merged into failed #${existing.id} (${name}) and queued it again`);
    return true;
  }
  const filter = await categoryFilter(agent, ai.want, () => repo.getRegionCategories(existing.id));
  if (filter) await repo.mergeRegion(region.id, existing.id, region.query, filter);
  else await repo.mergeRegion(region.id, existing.id, region.query);
  log(`merged into #${existing.id} (${name})${filter ? ', filter ' + filter.categories.join('/') : ''}`);
  return true;
}

// 저장 + 준비 완료 + 별칭. 네이버 경로와 공공데이터 경로가 같이 쓴다.
async function finishRegion(repo, region, ai, agent, kept) {
  await repo.upsertPlaces(kept);
  await repo.linkPlaces(region.id, kept.map((i) => i.naver_id));
  await repo.markReady(region.id);
  const filter = await categoryFilter(agent, ai.want, async () => [...new Set(kept.map((i) => i.category).filter(Boolean))]);
  if (filter) await repo.upsertAlias(region.query, region.id, filter);
  else await repo.upsertAlias(region.query, region.id);
  return filter;
}

// 네이버에 구획이 없을 때: 공공데이터(소상공인 상가정보)로 대신 수집한다. 처리했으면 true.
async function collectFromPublicData(repo, region, ai, center, { agent, publicData, log }) {
  const stores = await publicData.fetchFoodStores({ cx: center.x, cy: center.y, radius: PUBLIC_RADIUS_M });
  const counts = new Map();
  for (const st of stores) if (st.road) counts.set(st.road, (counts.get(st.road) ?? 0) + 1);
  const roads = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
  const pick = agent.pickRoad ? await agent.pickRoad(ai.query, roads) : { index: null, reason: null };
  let items, source_key, name;
  if (pick.index != null && roads[pick.index]) {
    const road = roads[pick.index];
    items = stores.filter((st) => st.road === road);
    source_key = `public:road:${items[0].road_code ?? road}`;
    name = `${road} 연변 (공공데이터)`;
    log(`public data: road "${road}" ${items.length} stores${pick.reason ? ' — ' + pick.reason : ''}`);
  } else {
    items = stores.filter((st) => metersBetween([st.lng, st.lat], [center.x, center.y]) <= PUBLIC_NEAR_M);
    source_key = `public:pt:${center.x.toFixed(4)},${center.y.toFixed(4)}`;
    name = `${region.query} 주변 ${PUBLIC_NEAR_M}m (공공데이터)`;
    log(`public data: no road, ${items.length} stores within ${PUBLIC_NEAR_M} m`);
  }
  if (!items.length) return false;
  if (await mergeIfExists(repo, region, source_key, name, ai, agent, log)) return true;
  const polygon = convexHull(items.map((i) => [i.lng, i.lat]));
  const bbox = bboxOfFeature({ geometry: polygon });
  await repo.setRegionPolygon(region.id, { source_kind: 'public', source_key, source_name: name, polygon, bbox, name: region.query });
  const kept = items.map(({ road, road_code, ...place }) => place);
  const filter = await finishRegion(repo, region, ai, agent, kept);
  log(`ready (public data): ${kept.length} places${filter ? ', filter ' + filter.categories.join('/') : ''}`);
  return true;
}

export async function collectRegion(repo, region, { runRepl, log = () => {}, agent = createAgent({ log }), publicData = createPublicData() }) {
  try {
    const ai = await agent.interpretQuery(region.query);
    if (ai.query !== region.query || ai.note) {
      await repo.setRegionAi(region.id, { search_query: ai.query, ai_note: ai.note });
      log(`agent: "${region.query}" → "${ai.query}"${ai.note ? ' (' + ai.note + ')' : ''}`);
    }
    const raw = await runRepl(regionScript(ai.query));
    const r = await pickPolygon(raw, region.query, agent, log);
    if (!r) {
      if (publicData?.enabled && raw?.center && await collectFromPublicData(repo, region, ai, raw.center, { agent, publicData, log })) return;
      await repo.failRegion(region.id, MESSAGES.NO_POLYGON);
      return;
    }
    const source_key = r.kind + ':' + r.key;
    if (await mergeIfExists(repo, region, source_key, r.name, ai, agent, log)) return;
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
    const filter = await finishRegion(repo, region, ai, agent, kept);
    log(`ready: ${kept.length} places inside of ${seen.size} fetched (${p.leaves} leaves)${filter ? ', filter ' + filter.categories.join('/') : ''}`);
  } catch (e) {
    await repo.failRegion(region.id, ('수집 중 오류: ' + (e?.message ?? String(e))).slice(0, 220));
  }
}
