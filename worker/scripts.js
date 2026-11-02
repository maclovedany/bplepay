// Aside REPL 안에서 실행될 자바스크립트를 문자열로 만든다.
// 결과는 반드시 console.log('@@RESULT@@' + JSON) 한 줄로 돌려준다.
import { parseApolloState } from './apollo.js';
import { splitBbox } from '../lib/geo.js';

const PARSER_SRC = parseApolloState.toString();
const SPLIT_SRC = splitBbox.toString();

export function regionScript(query) {
  const url = 'https://map.naver.com/p/search/' + encodeURIComponent(query);
  return `
${PARSER_SRC}
const page = await openTab(${JSON.stringify(url)});
await sleep(5000);
let result = null;
const admUrl = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name).find(u => /\\/p\\/api\\/polygon\\?.*order=adm/.test(u)) || null);
if (admUrl) {
  const fc = await page.evaluate(async (u) => (await fetch(u, { headers: { accept: 'application/json' } })).json(), admUrl);
  const f = fc && fc.features && fc.features[0];
  if (f) result = { kind: 'adm', key: String(f.properties.navercode), name: f.properties.area3 || f.properties.area2 || '', feature: f };
} else {
  const frame = page.frames().find(f => /pcmap\\.place\\.naver\\.com\\/place\\/list/.test(f.url()));
  if (frame) {
    const cand = await frame.evaluate(${PARSER_SRC} + '; (' + (() => {
      const text = Array.from(document.scripts).map(s => s.textContent).find(t => t.includes('__APOLLO_STATE__')) || '';
      const st = parseApolloState(text) || {};
      const items = Object.keys(st).filter(k => k.startsWith('PlaceListBusinessesItem:')).map(k => st[k]);
      const it = items.find(i => i.poiInfo && i.poiInfo.polygon && i.poiInfo.polygon.shapeKey && i.poiInfo.polygon.shapeKey.__ref);
      return it ? { id: it.poiInfo.polygon.shapeKey.__ref.split(':')[1], x: it.x, y: it.y, name: it.name } : null;
    }).toString() + ')()');
    if (cand) {
      const purl = 'https://map.naver.com/p/api/polygon?lng=' + cand.x + '&lat=' + cand.y + '&order=develope&keyword=' + cand.id;
      const fc = await page.evaluate(async (u) => (await fetch(u, { headers: { accept: 'application/json' } })).json(), purl);
      const f = fc && fc.features && fc.features[0];
      if (f) result = { kind: 'develope', key: String(cand.id), name: cand.name, feature: f };
    }
  }
}
console.log('@@RESULT@@' + JSON.stringify(result || { error: 'no_polygon' }));
`;
}

export function placesScript(bbox, { maxLeaves = 24, maxDepth = 5, budgetMs = 100000 } = {}) {
  return `
${PARSER_SRC}
${SPLIT_SRC}
const started = Date.now();
const queue = [{ bbox: ${JSON.stringify(bbox)}, depth: 0 }];
const items = [];
let leaves = 0;
let page = null;
let result = null;
const listUrl = (b) => {
  const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  return 'https://pcmap.place.naver.com/restaurant/list?query=' + encodeURIComponent('음식점') +
    '&x=' + cx + '&y=' + cy + '&clientX=' + cx + '&clientY=' + cy +
    '&bounds=' + encodeURIComponent(b.join(';')) + '&display=100&locale=ko&svcName=map_pcv5';
};
const readPage = (() => {
  const text = Array.from(document.scripts).map(s => s.textContent).find(t => t.includes('__APOLLO_STATE__')) || '';
  const st = parseApolloState(text) || {};
  const rq = st.ROOT_QUERY || {};
  const key = Object.keys(rq).find(k => k.startsWith('placeList') && k.includes('"display":100'));
  const total = key && rq[key].businesses ? rq[key].businesses.total : 0;
  const list = Object.keys(st).filter(k => k.startsWith('PlaceListBusinessesItem:')).map(k => st[k]).map(it => ({
    naver_id: String(it.id), name: it.name, category: it.category || null, road_address: it.roadAddress || null,
    address: it.address || null, phone: it.phone || null, lng: Number(it.x), lat: Number(it.y),
  }));
  return { total, list };
}).toString();
while (queue.length) {
  if (Date.now() - started > ${budgetMs}) { result = { error: 'too_wide' }; break; }
  const node = queue.shift();
  const url = listUrl(node.bbox);
  if (!page) page = await openTab(url); else await page.goto(url);
  await sleep(800);
  const r = await page.evaluate(${PARSER_SRC} + '; (' + readPage + ')()');
  if (r.total > 100 && node.depth < ${maxDepth}) {
    for (const b of splitBbox(node.bbox)) queue.push({ bbox: b, depth: node.depth + 1 });
    continue;
  }
  leaves++;
  if (leaves > ${maxLeaves}) { result = { error: 'too_wide' }; break; }
  for (const it of r.list) items.push(it);
}
console.log('@@RESULT@@' + JSON.stringify(result || { items, leaves }));
`;
}
