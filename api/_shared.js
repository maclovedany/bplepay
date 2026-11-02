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
