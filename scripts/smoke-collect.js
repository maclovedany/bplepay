// 실제 Aside + 네이버 지도로 수집 스크립트를 돌려 본다. DB는 건드리지 않는다.
// 사용: node scripts/smoke-collect.js "대구 중구 삼덕동"
import { runRepl } from '../worker/aside.js';
import { regionScript } from '../worker/scripts.js';
import { bboxOfFeature, pointInGeometry } from '../lib/geo.js';
import { pickPolygon, collectPlaces } from '../worker/collect.js';
import { createAgent } from '../worker/agent.js';
import { createPublicData } from '../worker/publicdata.js';

const query = process.argv.slice(2).join(' ');
if (!query) { console.error('usage: node scripts/smoke-collect.js <query>'); process.exit(1); }
const t0 = Date.now();
const agent = createAgent({ log: (m) => console.log('  agent:', m) });
const ai = await agent.interpretQuery(query);
console.log(`agent: "${query}" → "${ai.query}"${ai.note ? ' (' + ai.note + ')' : ''} (${Date.now() - t0}ms)`);
const raw = await runRepl(regionScript(ai.query));
if (raw.candidates) console.log('candidates:', raw.candidates.map((c) => `${c.name} [${c.category}] ${c.address} poly=${raw.features[c.id] ? 'Y' : 'N'}`).join(' | '));
const r = await pickPolygon(raw, query, agent, (m) => console.log('  agent:', m));
if (!r) {
  console.log('region: no_polygon', raw.center ? `center=${raw.center.x},${raw.center.y} (${raw.center.name || '지도 중심'})` : 'no center', `(${Date.now() - t0}ms)`);
  const pub = createPublicData();
  if (pub.enabled && raw.center) {
    const stores = await pub.fetchFoodStores({ cx: raw.center.x, cy: raw.center.y, radius: 1000 });
    const counts = new Map();
    for (const st of stores) if (st.road) counts.set(st.road, (counts.get(st.road) ?? 0) + 1);
    const roads = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const pick = await agent.pickRoad(query, roads);
    console.log(`public: ${stores.length} food stores within 1 km, ${roads.length} roads; pickRoad → ${pick.index == null ? 'none' : roads[pick.index]}${pick.reason ? ' (' + pick.reason + ')' : ''}`);
    if (pick.index != null) console.log('sample:', stores.filter((st) => st.road === roads[pick.index]).slice(0, 3).map((i) => `${i.name} | ${i.category} | ${i.road_address}`).join(' / '));
  }
  process.exit(0);
}
const bbox = bboxOfFeature(r.feature);
console.log(`kind=${r.kind} key=${r.key} name=${r.name} bbox=${bbox.map((n) => n.toFixed(5)).join(',')} (${Date.now() - t0}ms)`);
const t1 = Date.now();
const p = await collectPlaces(runRepl, bbox, (m) => console.log('  ', m));
if (!p) { console.log('places: too_wide', `(${Date.now() - t1}ms)`); process.exit(0); }
const ids = new Set(p.items.map((i) => i.naver_id));
const inside = p.items.filter((i) => pointInGeometry([i.lng, i.lat], r.feature.geometry));
console.log(`items=${p.items.length} unique=${ids.size} leaves=${p.leaves} inside=${new Set(inside.map((i) => i.naver_id)).size} (${Date.now() - t1}ms)`);
console.log('sample:', inside.slice(0, 3).map((i) => `${i.name} | ${i.category} | ${i.road_address}`).join(' / '));
