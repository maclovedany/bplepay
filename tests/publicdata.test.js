import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStore, shortRoad, fetchFoodStores, createPublicData } from '../worker/publicdata.js';

const raw = { bizesId: 'MA0101', bizesNm: '안동갈비', brchNm: '본점', indsMclsNm: '한식', indsSclsNm: '돼지고기 구이/찜', lnoAdr: '대구광역시 중구 남성로 16-2', rdnmCd: '271104223134', rdnm: '대구광역시 중구 중앙대로', rdnmAdr: '대구광역시 중구 중앙대로 91', lon: '128.5885', lat: '35.8693' };

test('normalizeStore maps the public store record onto the places shape', () => {
  assert.deepEqual(normalizeStore(raw), {
    naver_id: 'MA0101', name: '안동갈비 본점', category: '돼지고기 구이/찜', road_address: '대구광역시 중구 중앙대로 91', address: '대구광역시 중구 남성로 16-2',
    phone: null, lng: 128.5885, lat: 35.8693, road: '중앙대로', road_code: '271104223134',
  });
});

test('shortRoad strips the city and district prefix', () => {
  assert.equal(shortRoad('대구광역시 중구 중앙대로81길'), '중앙대로81길');
  assert.equal(shortRoad(''), '');
});

function fakeApi(total, { resultCode = '00' } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const page = Number(u.searchParams.get('pageNo')), rows = Number(u.searchParams.get('numOfRows'));
    const start = (page - 1) * rows;
    const items = Array.from({ length: Math.max(0, Math.min(rows, total - start)) }, (_, i) => ({ ...raw, bizesId: 'MA' + (start + i) }));
    return { ok: true, json: async () => ({ header: { resultCode, resultMsg: 'x', stdrYm: '202609' }, body: { totalCount: total, items } }) };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test('fetchFoodStores pages through all results and asks only for food (I2)', async () => {
  const fetchImpl = fakeApi(1500);
  const stores = await fetchFoodStores({ cx: 128.5958, cy: 35.8667, radius: 1000 }, { key: 'K', fetchImpl, pageSize: 1000 });
  assert.equal(stores.length, 1500);
  assert.equal(fetchImpl.calls.length, 2);
  const u = new URL(fetchImpl.calls[0]);
  assert.equal(u.searchParams.get('serviceKey'), 'K');
  assert.equal(u.searchParams.get('indsLclsCd'), 'I2');
  assert.equal(u.searchParams.get('radius'), '1000');
  assert.equal(u.searchParams.get('type'), 'json');
  assert.equal(stores[0].naver_id, 'MA0');
});

test('fetchFoodStores throws on an API error code and without a key', async () => {
  await assert.rejects(fetchFoodStores({ cx: 1, cy: 1 }, { key: 'K', fetchImpl: fakeApi(5, { resultCode: '30' }) }), /30/);
  await assert.rejects(fetchFoodStores({ cx: 1, cy: 1 }, { key: '', fetchImpl: fakeApi(5) }), /DATA_GO_KR_KEY/);
});

test('createPublicData is disabled without a key', () => {
  assert.equal(createPublicData({ key: '' }).enabled, false);
  assert.equal(createPublicData({ key: 'K' }).enabled, true);
});
