import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseApolloState } from '../worker/apollo.js';

const html = 'x; window.__APOLLO_STATE__ = {"A:1":{"n":"a}b","v":"q\\"z"},"ROOT_QUERY":{}}; window.z=1;';

test('parses balanced object with tricky strings', () => {
  assert.deepEqual(parseApolloState(html), { 'A:1': { n: 'a}b', v: 'q"z' }, ROOT_QUERY: {} });
});

test('returns null when absent', () => {
  assert.equal(parseApolloState('nothing'), null);
});

test('is self-contained (toString has no imports)', () => {
  const src = parseApolloState.toString();
  assert.ok(src.startsWith('function parseApolloState'));
  assert.ok(!/import|require/.test(src));
});
