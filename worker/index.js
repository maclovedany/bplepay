// 이 Mac에서 계속 떠 있는 수집 워커. Supabase 의 collecting 지역을 3초마다 하나씩 처리한다.
import 'dotenv/config';
import { getDb } from '../lib/db.js';
import { createRepo } from '../lib/repo.js';
import { checkAside, runRepl } from './aside.js';
import { collectRegion } from './collect.js';

const POLL_MS = 3000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), '[worker]', ...a);

if (!(await checkAside())) {
  console.error('Aside 브라우저에 연결할 수 없습니다. open -a Aside 후 다시 실행하세요.');
  process.exit(1);
}
const repo = createRepo(getDb());
log('연결 확인. collecting 지역을 기다립니다. (Ctrl+C 로 종료)');

let running = true;
process.on('SIGINT', () => { running = false; log('종료 중…'); });

while (running) {
  let region = null;
  try { region = await repo.nextCollecting(); }
  catch (e) { log('DB 오류:', e.message); }
  if (region) {
    const t0 = Date.now();
    log(`#${region.id} "${region.query}" 수집 시작`);
    await repo.markStarted(region.id);
    await collectRegion(repo, region, { runRepl, log: (m) => log(`#${region.id} ${m}`) });
    const after = await repo.getRegion(region.id).catch(() => null);
    log(`#${region.id} "${region.query}" → ${after?.status ?? '?'}${after?.error ? ' (' + after.error + ')' : ''} ${Math.round((Date.now() - t0) / 1000)}s`);
  } else {
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
process.exit(0);
