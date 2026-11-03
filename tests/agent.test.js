import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '../worker/agent.js';

const ok = (answer) => { const fn = async (req) => { fn.last = req; return answer; }; return fn; };
const boom = async () => { throw new Error('quota'); };

test('interpretQuery returns the model query and note', async () => {
  const ask = ok({ query: '대구 중구 교동', note: '대구 조사 맥락에 맞춰 시·구를 붙임' });
  const a = createAgent({ askJson: ask, context: '대구광역시 비플페이 조사' });
  assert.deepEqual(await a.interpretQuery('교동'), { query: '대구 중구 교동', note: '대구 조사 맥락에 맞춰 시·구를 붙임' });
  assert.match(ask.last.system, /대구광역시 비플페이 조사/);
  assert.match(ask.last.user, /교동/);
});

test('interpretQuery falls back to the raw query when the model fails or answers empty', async () => {
  assert.deepEqual(await createAgent({ askJson: boom }).interpretQuery('교동'), { query: '교동', note: null });
  assert.deepEqual(await createAgent({ askJson: ok({ query: '  ', note: 'x' }) }).interpretQuery('교동'), { query: '교동', note: null });
});

test('chooseCandidate returns the chosen index within range', async () => {
  const cands = [{ name: '동성로', category: '거리,골목', address: '대구 중구 용덕동' }, { name: '동성로로데오거리', category: '거리,골목', address: '대구 중구 삼덕동1가' }];
  const a = createAgent({ askJson: ok({ index: 1, reason: '먹자골목 의도' }) });
  assert.deepEqual(await a.chooseCandidate('동성로 먹자골목', cands), { index: 1, reason: '먹자골목 의도' });
});

test('chooseCandidate falls back to 0 on failure or out-of-range', async () => {
  const cands = [{ name: 'a' }, { name: 'b' }];
  assert.deepEqual(await createAgent({ askJson: boom }).chooseCandidate('q', cands), { index: 0, reason: null });
  assert.deepEqual(await createAgent({ askJson: ok({ index: 7, reason: 'x' }) }).chooseCandidate('q', cands), { index: 0, reason: null });
});

test('chooseCandidate skips the model when there is one candidate', async () => {
  const ask = ok({ index: 0, reason: 'never' });
  assert.deepEqual(await createAgent({ askJson: ask }).chooseCandidate('q', [{ name: 'only' }]), { index: 0, reason: null });
  assert.equal(ask.last, undefined);
});

test('suggestNarrower returns up to 4 non-empty strings, [] on failure', async () => {
  const a = createAgent({ askJson: ok({ queries: ['대구 중구 삼덕동1가', '', '대구 중구 삼덕동2가', '대구 중구 삼덕동3가', 'x', 'y'] }) });
  assert.deepEqual(await a.suggestNarrower('삼덕동', '삼덕동'), ['대구 중구 삼덕동1가', '대구 중구 삼덕동2가', '대구 중구 삼덕동3가', 'x']);
  assert.deepEqual(await createAgent({ askJson: boom }).suggestNarrower('삼덕동', '삼덕동'), []);
});
