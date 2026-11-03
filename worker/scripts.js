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
let firstHit = null; // 구획이 없을 때 기준점으로 쓸 첫 번째 검색 결과
const admUrl = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name).find(u => /\\/p\\/api\\/polygon\\?.*order=adm/.test(u)) || null);
if (admUrl) {
  const fc = await page.evaluate(async (u) => (await fetch(u, { headers: { accept: 'application/json' } })).json(), admUrl);
  const f = fc && fc.features && fc.features[0];
  if (f) result = { kind: 'adm', key: String(f.properties.navercode), name: f.properties.area3 || f.properties.area2 || '', feature: f };
} else {
  const frame = page.frames().find(f => /pcmap\\.place\\.naver\\.com\\/place\\/list/.test(f.url()));
  if (frame) {
    const parsed = await frame.evaluate(${PARSER_SRC} + '; (' + (() => {
      const text = Array.from(document.scripts).map(s => s.textContent).find(t => t.includes('__APOLLO_STATE__')) || '';
      const st = parseApolloState(text) || {};
      const items = Object.keys(st).filter(k => k.startsWith('PlaceListBusinessesItem:')).map(k => st[k]);
      const first = items[0] ? { x: Number(items[0].x), y: Number(items[0].y), name: items[0].name } : null;
      const cands = items
        .filter(i => i.poiInfo && i.poiInfo.polygon && i.poiInfo.polygon.shapeKey && i.poiInfo.polygon.shapeKey.__ref)
        .slice(0, 5)
        .map(i => ({ id: i.poiInfo.polygon.shapeKey.__ref.split(':')[1], x: i.x, y: i.y, name: i.name, category: i.category || '', address: i.commonAddress || i.address || '' }));
      return { cands, first };
    }).toString() + ')()');
    const cands = parsed && parsed.cands;
    if (parsed && parsed.first && parsed.first.x && parsed.first.y) firstHit = parsed.first;
    if (cands && cands.length) {
      const features = {};
      for (const c of cands) {
        const purl = 'https://map.naver.com/p/api/polygon?lng=' + c.x + '&lat=' + c.y + '&order=develope&keyword=' + c.id;
        try {
          const fc = await page.evaluate(async (u) => (await fetch(u, { headers: { accept: 'application/json' } })).json(), purl);
          features[c.id] = (fc && fc.features && fc.features[0]) || null;
        } catch (e) { features[c.id] = null; }
      }
      result = { kind: 'develope', candidates: cands, features };
    }
  }
}
if (!result) {
  // 구획이 없어도 첫 번째 검색 결과(중앙로역, 경상감영공원 …)의 좌표를 돌려준다. 공공데이터 대체 수집의 기준점.
  // 결과가 없으면 목록 URL 의 x, y(지도 중심).
  let center = firstHit;
  const listFrame = page.frames().find(f => /pcmap\\.place\\.naver\\.com\\/place\\/list/.test(f.url()));
  if (!center && listFrame) {
    const u = new URL(listFrame.url());
    const x = Number(u.searchParams.get('x')), y = Number(u.searchParams.get('y'));
    if (x && y) center = { x, y, name: null };
  }
  result = { error: 'no_polygon', center };
}
console.log('@@RESULT@@' + JSON.stringify(result));
`;
}

// bbox 하나 또는 여러 개에서 시작한다. 시간 예산이 끝나면 아직 못 본 상자를 pending 으로 돌려주고,
// 워커가 그 상자들로 다음 호출을 이어 간다 (REPL 한 번은 120초 제한).
export function placesScript(bbox, { maxDepth = 7, budgetMs = 100000, batch = 6 } = {}) {
  const bboxes = Array.isArray(bbox[0]) ? bbox : [bbox];
  return `
${PARSER_SRC}
${SPLIT_SRC}
const started = Date.now();
const queue = ${JSON.stringify(bboxes)}.map(b => ({ bbox: b, depth: 0 }));
const items = [];
let leaves = 0;
const listUrl = (b) => {
  const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  return 'https://pcmap.place.naver.com/restaurant/list?query=' + encodeURIComponent('음식점') +
    '&x=' + cx + '&y=' + cy + '&clientX=' + cx + '&clientY=' + cy +
    '&bounds=' + encodeURIComponent(b.join(';')) + '&display=100&locale=ko&svcName=map_pcv5';
};
// 같은 출처(pcmap) 탭을 하나 열어 두고, 잎마다 페이지를 다시 여는 대신 fetch 로 HTML 만 받아 파싱한다.
const page = await openTab(listUrl(queue[0].bbox));
await sleep(1000);
const fetchPages = (async (urls, boxes) => {
  const read = (html, b) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const text = Array.from(doc.scripts).map(s => s.textContent).find(t => t.includes('__APOLLO_STATE__')) || '';
    const st = parseApolloState(text) || {};
    const rq = st.ROOT_QUERY || {};
    const key = Object.keys(rq).find(k => k.startsWith('placeList') && k.includes('"display":100'));
    const total = key && rq[key].businesses ? rq[key].businesses.total : 0;
    const list = Object.keys(st).filter(k => k.startsWith('PlaceListBusinessesItem:')).map(k => st[k]).map(it => ({
      naver_id: String(it.id), name: it.name, category: it.category || null, road_address: it.roadAddress || null,
      address: it.address || null, phone: it.phone || null, lng: Number(it.x), lat: Number(it.y),
    }));
    // 상자 안에 든 결과가 하나도 없으면 네이버가 bounds 를 무시하고 전국 검색으로 떨어진 것이다
    // (total 이 수십만으로 뜬다). 그런 상자는 더 쪼개지 말고 빈 잎으로 본다.
    const inside = list.filter(it => it.lng >= b[0] && it.lng <= b[2] && it.lat >= b[1] && it.lat <= b[3]).length;
    return { total, list: inside ? list : [], inside };
  };
  return Promise.all(urls.map(async (u, i) => read(await (await fetch(u, { credentials: 'include' })).text(), boxes[i])));
}).toString();
while (queue.length && Date.now() - started < ${budgetMs}) {
  const nodes = queue.splice(0, ${batch});
  const rs = await page.evaluate(${PARSER_SRC} + '; (' + fetchPages + ')(' + JSON.stringify(nodes.map(n => listUrl(n.bbox))) + ',' + JSON.stringify(nodes.map(n => n.bbox)) + ')');
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i], r = rs[i];
    if (r.total > 100 && r.inside > 0 && node.depth < ${maxDepth}) {
      for (const b of splitBbox(node.bbox)) queue.push({ bbox: b, depth: node.depth + 1 });
      continue;
    }
    leaves++;
    for (const it of r.list) items.push(it);
  }
}
console.log('@@RESULT@@' + JSON.stringify({ items, leaves, pending: queue.map(n => n.bbox) }));
`;
}
