// 로컬 개발 서버: public/ 정적 파일 + api/ 서버리스 함수를 Vercel 식으로 호출한다.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = Number(process.env.PORT || 3000);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

async function listApiFiles(dir, prefix = '') {
  const out = [];
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('_')) continue;
    const rel = prefix + '/' + ent.name;
    if (ent.isDirectory()) out.push(...(await listApiFiles(path.join(dir, ent.name), rel)));
    else if (ent.name.endsWith('.js')) out.push(rel.replace(/\.js$/, ''));
  }
  return out;
}

function matchRoute(routes, urlPath) {
  const parts = urlPath.replace(/\/+$/, '').split('/').filter(Boolean); // ['api','regions','3']
  for (const route of routes) {
    const rparts = route.split('/').filter(Boolean);
    const isIndex = rparts[rparts.length - 1] === 'index';
    const eff = isIndex ? rparts.slice(0, -1) : rparts;
    if (eff.length !== parts.length - 1) continue; // minus leading 'api'
    const params = {};
    let ok = true;
    for (let i = 0; i < eff.length; i++) {
      const seg = eff[i], actual = parts[i + 1];
      const m = seg.match(/^\[(\w+)\]$/);
      if (m) params[m[1]] = decodeURIComponent(actual);
      else if (seg !== actual) { ok = false; break; }
    }
    if (ok) return { file: path.join(ROOT, 'api', route + '.js'), params };
  }
  return null;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : undefined); } catch { resolve(undefined); } });
  });
}

function vercelRes(res) {
  res.status = (n) => { res.statusCode = n; return res; };
  res.json = (b) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(b)); return res; };
  res.send = (b) => { res.end(b); return res; };
  return res;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      const routes = await listApiFiles(path.join(ROOT, 'api'));
      const match = matchRoute(routes, url.pathname);
      if (!match) { res.statusCode = 404; return res.end('no api route'); }
      req.query = { ...Object.fromEntries(url.searchParams), ...match.params };
      req.body = await readBody(req);
      const mod = await import(pathToFileURL(match.file).href + '?t=' + Date.now());
      return await mod.default(req, vercelRes(res));
    }
    let file = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!path.extname(file)) file += '.html'; // cleanUrls
    const abs = path.join(ROOT, 'public', path.normalize(file));
    if (!abs.startsWith(path.join(ROOT, 'public'))) { res.statusCode = 403; return res.end(); }
    const data = await fs.readFile(abs);
    res.setHeader('Content-Type', MIME[path.extname(abs)] ?? 'application/octet-stream');
    res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT') { res.statusCode = 404; return res.end('not found'); }
    console.error(e);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => console.log(`dev server http://localhost:${PORT}`));
