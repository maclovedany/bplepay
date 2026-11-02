import { handlers, methodNotAllowed } from '../../_shared.js';

export default async function handler(req, res) {
  if (req.method === 'PUT') return handlers().surveyPut(req, res);
  return methodNotAllowed(res, ['PUT']);
}
