// 실제 Aside + 네이버 지도로 수집 스크립트를 돌려 본다. DB는 건드리지 않는다.
// 사용: node scripts/smoke-collect.js "대구 중구 삼덕동"
import { runRepl } from '../worker/aside.js';
import { regionScript, placesScript } from '../worker/scripts.js';
import { bboxOfFeature, pointInGeometry } from '../lib/geo.js';

const query = process.argv.slice(2).join(' ');
if (!query) { console.error('usage: node scripts/smoke-collect.js <query>'); process.exit(1); }
const t0 = Date.now();
const r = await runRepl(regionScript(query));
if (r.error) { console.log('region:', r.error, `(${Date.now() - t0}ms)`); process.exit(0); }
const bbox = bboxOfFeature(r.feature);
console.log(`kind=${r.kind} key=${r.key} name=${r.name} bbox=${bbox.map((n) => n.toFixed(5)).join(',')} (${Date.now() - t0}ms)`);
const t1 = Date.now();
const p = await runRepl(placesScript(bbox));
if (p.error) { console.log('places:', p.error, `(${Date.now() - t1}ms)`); process.exit(0); }
const ids = new Set(p.items.map((i) => i.naver_id));
const inside = p.items.filter((i) => pointInGeometry([i.lng, i.lat], r.feature.geometry));
console.log(`items=${p.items.length} unique=${ids.size} leaves=${p.leaves} inside=${new Set(inside.map((i) => i.naver_id)).size} (${Date.now() - t1}ms)`);
console.log('sample:', inside.slice(0, 3).map((i) => `${i.name} | ${i.category} | ${i.road_address}`).join(' / '));
