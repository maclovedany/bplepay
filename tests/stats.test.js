import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, statsToCsv } from '../lib/stats.js';

const regions = [{ id: 1, name: '동성로' }, { id: 2, name: '삼덕동' }];
const links = [
  { region_id: 1, naver_id: 'a' }, { region_id: 1, naver_id: 'b' },
  { region_id: 2, naver_id: 'b' }, { region_id: 2, naver_id: 'c' },
];
const surveys = [{ naver_id: 'a', status: 'yes' }, { naver_id: 'b', status: 'no' }];

test('per-region counts', () => {
  const s = computeStats(regions, links, surveys);
  assert.deepEqual(s.regions[0], { id: 1, name: '동성로', total: 2, surveyed: 2, progress: 1, yes: 1, no: 1, rate: 0.5 });
  assert.deepEqual(s.regions[1], { id: 2, name: '삼덕동', total: 2, surveyed: 1, progress: 0.5, yes: 0, no: 1, rate: 0 });
});

test('all dedupes shared place b', () => {
  const s = computeStats(regions, links, surveys);
  assert.deepEqual(s.all, { name: '합계', total: 3, surveyed: 2, progress: 2 / 3, yes: 1, no: 1, rate: 0.5 });
});

test('rate null when nothing surveyed', () => {
  const s = computeStats([{ id: 9, name: 'x' }], [{ region_id: 9, naver_id: 'z' }], []);
  assert.equal(s.regions[0].rate, null);
});

test('csv has BOM, header, total row', () => {
  const csv = statsToCsv(computeStats(regions, links, surveys));
  const lines = csv.split('\n');
  assert.ok(csv.startsWith('﻿'));
  assert.equal(lines[0].replace('﻿', ''), '지역,식당 수,조사 완료,진행률(%),가능,불가능,가맹률(%)');
  assert.equal(lines[1], '동성로,2,2,100.0,1,1,50.0');
  assert.equal(lines[3], '합계,3,2,66.7,1,1,50.0');
});
