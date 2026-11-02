export function normalizeQuery(q) {
  return String(q ?? '').trim().replace(/\s+/g, ' ');
}
