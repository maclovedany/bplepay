import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placesScript } from '../worker/scripts.js';

// placesScript 가 만든 문자열을 가짜 Aside 환경(openTab/sleep/fetch/DOMParser)에서 실제로 실행해 본다.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function fakeNaver(answer) {
  // answer(bounds[]) → { total, items:[{id,x,y}] }
  const fetched = [];
  const html = (u) => {
    const b = decodeURIComponent(new URL(u).searchParams.get('bounds')).split(';').map(Number);
    fetched.push(b);
    const { total, items } = answer(b);
    const st = { ROOT_QUERY: { ['placeList({"input":{"bounds":"' + b.join(';') + '","display":100}})']: { businesses: { total } } } };
    for (const it of items) st['PlaceListBusinessesItem:' + it.id] = { id: it.id, name: 'N' + it.id, x: String(it.x), y: String(it.y) };
    return '<script>window.__APOLLO_STATE__ = ' + JSON.stringify(st) + ';</script>';
  };
  const page = {
    evaluate(expr) {
      const fetch = async (u) => ({ text: async () => html(u) });
      const DOMParser = function () { this.parseFromString = (h) => ({ scripts: [{ textContent: h }] }); };
      return eval(expr);
    },
  };
  return { fetched, openTab: async () => page, sleep: async () => {} };
}

async function run(script, env) {
  let out = null;
  const console = { log: (s) => { if (s.startsWith('@@RESULT@@')) out = JSON.parse(s.slice(10)); } };
  await new AsyncFunction('openTab', 'sleep', 'console', script)(env.openTab, env.sleep, console);
  return out;
}

test('a box whose results all lie outside it (Naver nationwide fallback) is a leaf, not split again', async () => {
  const env = fakeNaver((b) => {
    const w = b[2] - b[0];
    if (w > 5) return { total: 150, items: [{ id: 1, x: 2, y: 2 }, { id: 2, x: 8, y: 8 }] }; // 뿌리: 100 넘음 → 4분할
    // 자식 상자: 왼쪽 아래만 진짜 결과, 나머지는 전국 검색으로 떨어져 엉뚱한 곳의 102개가 온다
    if (b[0] === 0 && b[1] === 0) return { total: 60, items: [{ id: 1, x: 2, y: 2 }] };
    return { total: 902514, items: Array.from({ length: 102 }, (_, i) => ({ id: 1000 + i, x: 500 + i, y: 500 })) };
  });
  const r = await run(placesScript([0, 0, 10, 10]), env);
  assert.equal(env.fetched.length, 5, '뿌리 1 + 자식 4, 더 쪼개지 않는다');
  assert.equal(r.leaves, 4);
  assert.deepEqual(r.pending, []);
  assert.deepEqual(r.items.map((i) => i.naver_id), ['1']);
});

test('boxes left when the time budget runs out are returned as pending', async () => {
  const env = fakeNaver((b) => ({ total: 150, items: [{ id: 1, x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 }] }));
  const r = await run(placesScript([0, 0, 10, 10], { budgetMs: 0, batch: 1 }), env);
  assert.equal(env.fetched.length, 0);
  assert.deepEqual(r.pending, [[0, 0, 10, 10]]);
  assert.equal(r.leaves, 0);
});
