import { handlers, methodNotAllowed, wrap } from '../../_shared.js';

export default wrap(async function handler(req, res) {
  if (req.method === 'PUT') return handlers().reactionPut(req, res);
  return methodNotAllowed(res, ['PUT']);
});
