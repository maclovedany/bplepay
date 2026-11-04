import { handlers, methodNotAllowed, wrap } from '../_shared.js';

export default wrap(async function handler(req, res) {
  if (req.method === 'GET') return handlers().placesInView(req, res);
  return methodNotAllowed(res, ['GET']);
});
