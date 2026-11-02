import { handlers, methodNotAllowed } from './_shared.js';

export default async function handler(req, res) {
  if (req.method === 'GET') return handlers().statsGet(req, res);
  return methodNotAllowed(res, ['GET']);
}
