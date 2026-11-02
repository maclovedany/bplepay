import { spawn } from 'node:child_process';
import 'dotenv/config';

export const RESULT_PREFIX = '@@RESULT@@';

export function runRepl(script, { bin = process.env.ASIDE_BIN ?? 'aside', profile = process.env.ASIDE_PROFILE, timeoutMs = 125000, onStderr } = {}) {
  if (!profile) return Promise.reject(new Error('ASIDE_PROFILE is required'));
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['repl', '--profile', profile, script], { env: process.env });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('aside repl failed: timeout after ' + timeoutMs + 'ms')); }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => { err += d; onStderr?.(String(d)); });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error('aside repl failed: ' + e.message)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const line = out.split('\n').filter((l) => l.startsWith(RESULT_PREFIX)).pop();
      if (code !== 0 || !line) {
        return reject(new Error('aside repl failed (exit ' + code + '): ' + (out + '\n' + err).trim().slice(-500)));
      }
      try { resolve(JSON.parse(line.slice(RESULT_PREFIX.length))); }
      catch (e) { reject(new Error('aside repl failed: bad result json: ' + e.message)); }
    });
  });
}

export async function checkAside(opts = {}) {
  try {
    const r = await runRepl("console.log('@@RESULT@@' + JSON.stringify({ok:1}))", { ...opts, timeoutMs: 30000 });
    return r?.ok === 1;
  } catch {
    return false;
  }
}
