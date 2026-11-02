import { handlers, methodNotAllowed } from '../_shared.js';

export default async function handler(req, res) {
  if (req.method === 'GET') return handlers().regionsList(req, res);
  if (req.method === 'POST') return handlers().regionsCreate(req, res);
  return methodNotAllowed(res, ['GET', 'POST']);
}
