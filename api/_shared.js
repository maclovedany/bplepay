import { getDb } from '../lib/db.js';
import { createRepo } from '../lib/repo.js';
import { createHandlers } from './_handlers.js';

let cached;
export function handlers() {
  if (!cached) cached = createHandlers(createRepo(getDb()));
  return cached;
}

export function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  res.status(405).json({ error: 'method not allowed' });
}

// 서버리스 함수에서 던져진 예외를 500 JSON 으로 바꾼다 (안 하면 FUNCTION_INVOCATION_FAILED 로 죽는다).
export function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e?.message ?? String(e) });
    }
  };
}
