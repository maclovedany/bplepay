import { handlers, methodNotAllowed, wrap } from '../_shared.js';

export default wrap(async function handler(req, res) {
  if (req.method === 'GET') return handlers().regionGet(req, res);
  if (req.method === 'DELETE') return handlers().regionDelete(req, res);
  return methodNotAllowed(res, ['GET', 'DELETE']);
});
