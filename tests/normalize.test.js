import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuery } from '../lib/normalize.js';

test('trims and collapses spaces', () => {
  assert.equal(normalizeQuery('  대구  중구   삼덕동 '), '대구 중구 삼덕동');
});

test('empty stays empty', () => {
  assert.equal(normalizeQuery('   '), '');
});
