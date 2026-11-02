import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runRepl, checkAside } from '../worker/aside.js';

const fake = path.resolve('tests/fixtures/fake-aside.sh');

test('runRepl parses @@RESULT@@ line', async () => {
  assert.deepEqual(await runRepl('x', { bin: fake, profile: 'p' }), { ok: 1, n: 3 });
});

test('runRepl rejects on nonzero exit', async () => {
  process.env.FAKE_FAIL = '1';
  try { await assert.rejects(runRepl('x', { bin: fake, profile: 'p' }), /aside repl failed/); }
  finally { delete process.env.FAKE_FAIL; }
});

test('runRepl passes profile and script as argv', async () => {
  const seen = [];
  await runRepl('console.log(42)', { bin: fake, profile: 'prof-1', onStderr: (s) => seen.push(s) });
  assert.match(seen.join(''), /ARGV:repl --profile prof-1 console\.log\(42\)/);
});

test('checkAside true with fake', async () => {
  assert.equal(await checkAside({ bin: fake, profile: 'p' }), true);
});
