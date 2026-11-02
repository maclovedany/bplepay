// 네이버 pcmap 페이지의 인라인 스크립트에서 window.__APOLLO_STATE__ 객체를 꺼낸다.
// 의존성 없이 자체 완결이어야 한다: toString() 으로 Aside REPL 안에 주입한다.
export function parseApolloState(text) {
  const i = text.indexOf('window.__APOLLO_STATE__');
  if (i < 0) return null;
  const j = text.indexOf('{', i);
  if (j < 0) return null;
  let depth = 0, inStr = false, esc = false, k = j;
  for (; k < text.length; k++) {
    const c = text[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { k++; break; } }
  }
  try { return JSON.parse(text.slice(j, k)); } catch { return null; }
}
