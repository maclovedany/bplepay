import { handlers, methodNotAllowed } from '../_shared.js';

export default async function handler(req, res) {
  if (req.method === 'GET') return handlers().regionGet(req, res);
  if (req.method === 'DELETE') return handlers().regionDelete(req, res);
  return methodNotAllowed(res, ['GET', 'DELETE']);
}
