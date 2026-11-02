import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrap } from '../api/_shared.js';

function fakeRes() {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = (n) => { res.statusCode = n; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}

test('wrap turns a thrown error into a 500 json body', async () => {
  const res = fakeRes();
  await wrap(async () => { throw new Error('db down'); })({ method: 'GET' }, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: 'db down' });
});

test('wrap passes through a normal response', async () => {
  const res = fakeRes();
  await wrap(async (req, r) => r.status(200).json({ ok: 1 }))({ method: 'GET' }, res);
  assert.deepEqual(res.body, { ok: 1 });
});
