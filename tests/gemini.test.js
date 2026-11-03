import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askJson } from '../lib/gemini.js';

const schema = { type: 'OBJECT', properties: { query: { type: 'STRING' } }, required: ['query'] };

function fakeFetch(reply, { status = 200 } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init: { ...init, body: JSON.parse(init.body) } });
    return { ok: status < 400, status, json: async () => reply, text: async () => JSON.stringify(reply) };
  };
  fn.calls = calls;
  return fn;
}

test('askJson sends system, user, schema and parses the JSON text', async () => {
  const fetchImpl = fakeFetch({ candidates: [{ content: { parts: [{ text: '{"query":"대구 중구 교동"}' }] } }] });
  const out = await askJson({ system: 'S', user: 'U', schema }, { apiKey: 'k', model: 'gemini-2.5-flash', fetchImpl });
  assert.deepEqual(out, { query: '대구 중구 교동' });
  const c = fetchImpl.calls[0];
  assert.match(c.url, /models\/gemini-2\.5-flash:generateContent$/);
  assert.equal(c.init.headers['x-goog-api-key'], 'k');
  assert.equal(c.init.body.systemInstruction.parts[0].text, 'S');
  assert.equal(c.init.body.contents[0].parts[0].text, 'U');
  assert.deepEqual(c.init.body.generationConfig.responseSchema, schema);
  assert.equal(c.init.body.generationConfig.responseMimeType, 'application/json');
});

test('askJson throws on http error', async () => {
  const fetchImpl = fakeFetch({ error: { message: 'bad key' } }, { status: 400 });
  await assert.rejects(askJson({ system: 'S', user: 'U', schema }, { apiKey: 'k', fetchImpl }), /gemini.*bad key/i);
});

test('askJson throws when apiKey missing', async () => {
  await assert.rejects(askJson({ system: 'S', user: 'U', schema }, { apiKey: '', fetchImpl: fakeFetch({}) }), /GEMINI_API_KEY/);
});
