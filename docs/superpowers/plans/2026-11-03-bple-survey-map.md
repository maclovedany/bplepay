# 비플페이 가맹점 현장조사 지도 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지역 이름을 입력하면 네이버 지도에서 구획·식당을 자동 수집해 지도에 띄우고, 조사원이 비플페이 가능/불가능을 눌러 저장하고 통계를 보는 웹 서비스.

**Architecture:** Vercel이 정적 프런트(`public/`)와 서버리스 API(`api/`)를 호스팅하고 Supabase Postgres에 저장한다. 이 Mac의 워커(`worker/`)가 `status='collecting'` 지역을 폴링해 Aside 브라우저 REPL로 네이버 지도를 읽어 폴리곤·식당을 채운다. 순수 로직은 `lib/`에 두고 Node 내장 테스트 러너로 검증한다.

**Tech Stack:** Node 22 (ESM, `node --test`), `@supabase/supabase-js` v2, Vercel Node functions, Leaflet 1.9 + OSM 타일, Aside CLI 1.26 (`aside repl`).

**Spec:** `docs/superpowers/specs/2026-11-03-bple-survey-map-design.md`

## Global Constraints

- Node 22 이상, ESM(`"type": "module"`). 빌드 도구 없음. 외부 의존성은 `@supabase/supabase-js`와 `dotenv`만.
- 비밀값은 `.env`(로컬)와 Vercel 환경변수에만: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ASIDE_PROFILE`. `.env`는 커밋 금지.
- Aside REPL 호출은 항상 `aside repl --profile <ASIDE_PROFILE> "<script>"`. 호출당 120초 상한. 결과는 `console.log('@@RESULT@@' + JSON.stringify(obj))` 한 줄로만 돌려받는다.
- 네이버 경로(스펙 4.4 그대로): 폴리곤 `https://map.naver.com/p/api/polygon?lng=&lat=&order=develope|adm&keyword=`; 식당 `https://pcmap.place.naver.com/restaurant/list?query=음식점&bounds=minx%3Bminy%3Bmaxx%3Bmaxy&x=&y=&clientX=&clientY=&display=100&locale=ko&svcName=map_pcv5`. `display` 상한 100, 페이징 없음 → bbox 4분할, 최대 깊이 5, 잎 24개 초과 시 실패.
- 상태값: regions.status ∈ `collecting | ready | failed | merged`; surveys.status ∈ `yes | no`.
- 사용자에게 보이는 문구는 스펙의 문장을 그대로 쓴다. 실패 메시지 세 가지: `구획 정보를 찾지 못했습니다. '대구 중구 삼덕동'처럼 동 이름으로 검색해 보세요.` / `범위가 너무 넓습니다. 동이나 거리 이름으로 검색해 주세요.` / `수집 워커가 꺼져 있습니다. 관리자에게 알려 주세요.`
- 통계 정의: 진행률 = surveyed/total, 가맹률 = yes/surveyed(surveyed 0이면 null → 화면 "–"), 합계는 naver_id 중복 제거.
- 모바일 버튼 높이 48px 이상. 가능 핀은 `#39ff14` 링이 1초 주기로 깜빡인다.
- 소스는 `https://github.com/maclovedany/bplepay`(main)에 푸시한다. 각 Task의 Commit 단계 뒤에 `git push`를 한다. Vercel은 이 저장소의 main 푸시로 자동 배포된다(Task 11에서 연결). 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` 줄을 붙인다.

## Review Focus

- 공백만 있는 입력("  ") → POST /api/regions가 400을 돌려주고 지역을 만들지 않는다. (Task 5 테스트)
- 네이버 결과에 폴리곤이 전혀 없는 입력("교동" 단독) → 지역이 `failed`가 되고 "구획 정보를 찾지 못했습니다…" 문구가 보인다. (Task 7 테스트)
- 구획이 너무 넓어 잎 24개를 넘는 입력 → `failed` + "범위가 너무 넓습니다…". (Task 7 테스트)
- 워커가 꺼진 채 3분이 지난 `collecting` 지역 → GET /api/regions/:id가 `failed` + "수집 워커가 꺼져 있습니다…"로 바꿔 돌려준다. (Task 5 테스트)
- 한 식당이 두 구획에 속할 때 합계가 두 번 세지지 않고, 한쪽에서 누른 가능/불가능이 다른 쪽에도 보인다. (Task 3 테스트)

---

## File Structure

```
package.json, vercel.json, .gitignore, .env(커밋 안 함), README.md
supabase/schema.sql          표 5개 + 인덱스
lib/normalize.js             normalizeQuery
lib/geo.js                   bboxOfFeature, pointInGeometry, splitBbox
lib/stats.js                 computeStats, statsToCsv
lib/db.js                    getDb() supabase 클라이언트
lib/repo.js                  createRepo(db) — DB 접근 전부
lib/messages.js              사용자 문구 상수
api/regions/index.js         GET 목록 / POST 생성
api/regions/[id].js          GET 상세 / DELETE
api/places/[naverId]/survey.js  PUT
api/stats.js                 GET (?format=csv)
api/_handlers.js             createHandlers(repo) — 테스트 가능한 순수 핸들러
scripts/dev-server.js        로컬 개발 서버 (public + api 라우팅)
worker/apollo.js             parseApolloState
worker/aside.js              runRepl, checkAside
worker/scripts.js            regionScript, placesScript (REPL용 JS 문자열 생성)
worker/collect.js            collectRegion
worker/index.js              폴링 루프
public/index.html, app.js, style.css, stats.html, stats.js
tests/*.test.js
```

---

### Task 1: 프로젝트 뼈대 + DB 스키마 + normalizeQuery

**Files:**
- Create: `package.json`, `vercel.json`, `supabase/schema.sql`, `lib/normalize.js`, `lib/messages.js`, `tests/normalize.test.js`
- Modify: `.gitignore` (이미 `.env`, `node_modules/`, `.vercel/` 있음)

**Interfaces:**
- Produces: `normalizeQuery(q: string): string` — trim 후 연속 공백을 한 칸으로. `MESSAGES = { NO_POLYGON, TOO_WIDE, WORKER_DOWN }` (Global Constraints의 문구 그대로).

- [ ] **Step 1: git 저장소 초기화**

Run: `cd /Users/danymac/Desktop/b-ple-pay && git init -b main && git remote add origin https://github.com/maclovedany/bplepay.git && git add .gitignore docs && git commit -m "docs: design spec and plan" && git push -u origin main`
Expected: GitHub 저장소(비어 있음)에 main 브랜치가 생긴다. 푸시 전 `git status`로 `.env`가 목록에 없는지 확인한다.

- [ ] **Step 2: package.json 작성**

```json
{ "name": "bple-survey-map", "private": true, "type": "module",
  "engines": { "node": ">=22" },
  "scripts": { "test": "node --test tests/", "dev": "node scripts/dev-server.js", "worker": "node worker/index.js" },
  "dependencies": { "@supabase/supabase-js": "^2.45.0", "dotenv": "^16.4.5" } }
```

`vercel.json`: `{ "cleanUrls": true }`.

Run: `npm install` → `node_modules` 생성, 오류 없음.

- [ ] **Step 3: supabase/schema.sql 작성**

```sql
create table if not exists regions (
  id bigint generated always as identity primary key,
  query text not null, name text not null,
  source_kind text check (source_kind in ('develope','adm')),
  source_key text unique, source_name text,
  polygon jsonb, bbox double precision[],
  status text not null default 'collecting' check (status in ('collecting','ready','failed','merged')),
  merged_into bigint references regions(id) on delete set null,
  error text, created_at timestamptz not null default now());
create table if not exists region_aliases (query text primary key, region_id bigint not null references regions(id) on delete cascade);
create table if not exists places (naver_id text primary key, name text not null, category text, road_address text, address text, phone text,
  lng double precision not null, lat double precision not null, created_at timestamptz not null default now());
create table if not exists region_places (region_id bigint references regions(id) on delete cascade, naver_id text references places(naver_id), primary key (region_id, naver_id));
create table if not exists surveys (naver_id text primary key references places(naver_id), status text not null check (status in ('yes','no')), updated_at timestamptz not null default now());
create index if not exists regions_status_idx on regions(status, created_at);
alter table regions enable row level security; alter table region_aliases enable row level security; alter table places enable row level security; alter table region_places enable row level security; alter table surveys enable row level security;
```

`source_key`는 `kind:key` 형식("adm:06110545", "develope:3696089")으로 저장한다. 이 SQL은 **사용자가 Supabase SQL 편집기에서 실행**해야 한다(서비스롤 키로는 DDL 불가). Task 4 전에 실행을 요청한다.

- [ ] **Step 4: 실패하는 테스트 작성** `tests/normalize.test.js`

```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { normalizeQuery } from '../lib/normalize.js';
test('trims and collapses spaces', () => { assert.equal(normalizeQuery('  대구  중구   삼덕동 '), '대구 중구 삼덕동'); });
test('empty stays empty', () => { assert.equal(normalizeQuery('   '), ''); });
```

- [ ] **Step 5: 실패 확인** Run: `npm test` → FAIL (module not found)
- [ ] **Step 6: `lib/normalize.js`, `lib/messages.js` 구현** 후 Run: `npm test` → PASS
- [ ] **Step 7: Commit** `git add -A && git commit -m "feat: project scaffold, schema, normalizeQuery"`

---

### Task 2: 지오메트리 유틸

**Files:**
- Create: `lib/geo.js`, `tests/geo.test.js`

**Interfaces:**
- Produces:
  - `bboxOfFeature(feature): [minx, miny, maxx, maxy]` — `feature.bbox`가 있으면 그대로, 없으면 좌표에서 계산.
  - `pointInGeometry([lng, lat], geometry): boolean` — `Polygon`/`MultiPolygon`, 구멍(holes) 처리, ray casting.
  - `splitBbox(bbox): [bbox, bbox, bbox, bbox]` — 중심으로 4등분.

- [ ] **Step 1: 실패하는 테스트 작성** `tests/geo.test.js`

```js
const square = { type: 'Polygon', coordinates: [[[0,0],[10,0],[10,10],[0,10],[0,0]]] };
const withHole = { type: 'Polygon', coordinates: [square.coordinates[0], [[4,4],[6,4],[6,6],[4,6],[4,4]]] };
const multi = { type: 'MultiPolygon', coordinates: [square.coordinates, [[[20,20],[30,20],[30,30],[20,30],[20,20]]]] };
test('inside square', () => assert.equal(pointInGeometry([5,5], square), true));
test('outside square', () => assert.equal(pointInGeometry([15,5], square), false));
test('in hole is outside', () => assert.equal(pointInGeometry([5,5], withHole), false));
test('second polygon of multi', () => assert.equal(pointInGeometry([25,25], multi), true));
test('bbox from coordinates', () => assert.deepEqual(bboxOfFeature({ type:'Feature', geometry: multi }), [0,0,30,30]));
test('bbox prefers feature.bbox', () => assert.deepEqual(bboxOfFeature({ bbox:[1,2,3,4], geometry: square }), [1,2,3,4]));
test('splitBbox quarters', () => assert.deepEqual(splitBbox([0,0,10,10]), [[0,0,5,5],[5,0,10,5],[0,5,5,10],[5,5,10,10]]));
```

- [ ] **Step 2: 실패 확인** Run: `node --test tests/geo.test.js` → FAIL
- [ ] **Step 3: `lib/geo.js` 구현** 후 Run: `node --test tests/geo.test.js` → PASS (7 tests)
- [ ] **Step 4: Commit** `git commit -am "feat: geo utils"` (새 파일은 `git add`)

---

### Task 3: 통계 계산 + CSV

**Files:**
- Create: `lib/stats.js`, `tests/stats.test.js`

**Interfaces:**
- Produces:
  - `computeStats(regions: {id, name}[], links: {region_id, naver_id}[], surveys: {naver_id, status}[]) → { regions: RegionStat[], all: RegionStat }`
    - `RegionStat = { id?, name, total, surveyed, progress: number|null, yes, no, rate: number|null }`, progress/rate는 0~1 소수. `all.name = '합계'`, `all`은 naver_id 중복 제거.
  - `statsToCsv(stats) → string` — 첫 글자 BOM(`﻿`), 헤더 `지역,식당 수,조사 완료,진행률(%),가능,불가능,가맹률(%)`, 퍼센트는 소수 첫째 자리, null은 빈칸, 마지막 행 합계.

- [ ] **Step 1: 실패하는 테스트 작성** `tests/stats.test.js`

```js
const regions = [{ id: 1, name: '동성로' }, { id: 2, name: '삼덕동' }];
const links = [{ region_id: 1, naver_id: 'a' }, { region_id: 1, naver_id: 'b' }, { region_id: 2, naver_id: 'b' }, { region_id: 2, naver_id: 'c' }];
const surveys = [{ naver_id: 'a', status: 'yes' }, { naver_id: 'b', status: 'no' }];
test('per-region counts', () => { const s = computeStats(regions, links, surveys);
  assert.deepEqual(s.regions[0], { id: 1, name: '동성로', total: 2, surveyed: 2, progress: 1, yes: 1, no: 1, rate: 0.5 });
  assert.deepEqual(s.regions[1], { id: 2, name: '삼덕동', total: 2, surveyed: 1, progress: 0.5, yes: 0, no: 1, rate: 0 }); });
test('all dedupes shared place b', () => { const s = computeStats(regions, links, surveys);
  assert.deepEqual(s.all, { name: '합계', total: 3, surveyed: 2, progress: 2/3, yes: 1, no: 1, rate: 0.5 }); });
test('rate null when nothing surveyed', () => { const s = computeStats([{ id: 9, name: 'x' }], [{ region_id: 9, naver_id: 'z' }], []); assert.equal(s.regions[0].rate, null); });
test('csv has BOM, header, total row', () => { const csv = statsToCsv(computeStats(regions, links, surveys)); const lines = csv.split('\n');
  assert.ok(csv.startsWith('﻿')); assert.equal(lines[0].replace('﻿',''), '지역,식당 수,조사 완료,진행률(%),가능,불가능,가맹률(%)');
  assert.equal(lines[1], '동성로,2,2,100.0,1,1,50.0'); assert.equal(lines[3], '합계,3,2,66.7,1,1,50.0'); });
```

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: `lib/stats.js` 구현** → `node --test tests/stats.test.js` PASS
- [ ] **Step 4: Commit** `git add lib/stats.js tests/stats.test.js && git commit -m "feat: stats and csv"`

---

### Task 4: Supabase 저장소 계층

**Files:**
- Create: `lib/db.js`, `lib/repo.js`, `tests/repo.integration.test.js`

**Interfaces:**
- Consumes: `normalizeQuery`, `supabase/schema.sql`이 적용된 DB.
- Produces: `getDb()` (env에서 클라이언트 생성, `dotenv/config` import), `createRepo(db)` → 아래 메서드. 모든 메서드는 Promise. `source_key`는 `"kind:key"`.
  - `findAlias(query) → {region_id}|null`
  - `findRegionByQuery(query) → Region|null` (status 무관, 최신 1건)
  - `createRegion({query, name}) → Region` (status collecting)
  - `getRegion(id) → Region|null`
  - `listRegions() → Region[]` (status ≠ merged, created_at 내림차순, polygon 제외)
  - `resetToCollecting(id)`; `failRegion(id, error)`; `markReady(id)`
  - `setRegionPolygon(id, {source_kind, source_key, source_name, polygon, bbox, name})`
  - `findRegionBySourceKey(source_key) → Region|null` (status ready만)
  - `mergeRegion(id, intoId, query)` — status merged, merged_into, alias upsert
  - `upsertAlias(query, region_id)`
  - `upsertPlaces(places: {naver_id,name,category,road_address,address,phone,lng,lat}[])`
  - `linkPlaces(region_id, naver_ids)` (중복 무시)
  - `getRegionPlaces(region_id) → (Place & {survey: 'yes'|'no'|null})[]`
  - `setSurvey(naver_id, status|null)` (null이면 삭제)
  - `deleteRegion(id)` (regions 행 삭제 → cascade로 alias·link 제거; places·surveys 유지)
  - `nextCollecting() → Region|null` (가장 오래된 collecting)
  - `staleCollecting(minutes) → Region[]`
  - `statsInput() → {regions, links, surveys}` (status ready인 지역만)

- [ ] **Step 1: 사용자에게 스키마 적용 요청** — Supabase SQL 편집기에서 `supabase/schema.sql` 실행. 확인: `curl -s "$SUPABASE_URL/rest/v1/regions?select=id&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"` → `[]`.

- [ ] **Step 2: 통합 테스트 작성** `tests/repo.integration.test.js` (env 없으면 `test.skip`). 테스트 지역 query는 `'__test__' + Date.now()`로 만들고 끝에 `deleteRegion`.

```js
test('region lifecycle', async () => {
  const r = await repo.createRegion({ query: q, name: q });            assert.equal(r.status, 'collecting');
  await repo.setRegionPolygon(r.id, { source_kind: 'adm', source_key: 'adm:test' + Date.now(), source_name: 'T', polygon: { type: 'Polygon', coordinates: [] }, bbox: [0,0,1,1], name: 'T' });
  await repo.upsertPlaces([{ naver_id: 'p1' + q, name: '식당', category: '한식', road_address: 'x', address: 'y', phone: null, lng: 0.5, lat: 0.5 }]);
  await repo.linkPlaces(r.id, ['p1' + q]); await repo.markReady(r.id); await repo.upsertAlias(q, r.id);
  assert.equal((await repo.findAlias(q)).region_id, r.id);
  await repo.setSurvey('p1' + q, 'yes');  assert.equal((await repo.getRegionPlaces(r.id))[0].survey, 'yes');
  await repo.setSurvey('p1' + q, null);   assert.equal((await repo.getRegionPlaces(r.id))[0].survey, null);
  await repo.deleteRegion(r.id);          assert.equal(await repo.getRegion(r.id), null);
});
```

- [ ] **Step 3: 실패 확인** → FAIL
- [ ] **Step 4: `lib/db.js`, `lib/repo.js` 구현.** `getRegionPlaces`는 `region_places` → `places` → `surveys` 두 번 조회 후 JS에서 합친다(조인 설정 불필요). `upsertPlaces`는 `onConflict: 'naver_id'`, `linkPlaces`는 `upsert(..., { ignoreDuplicates: true })`.
- [ ] **Step 5: 통과 확인** Run: `node --test tests/repo.integration.test.js` → PASS
- [ ] **Step 6: Commit** `git add lib/db.js lib/repo.js tests/repo.integration.test.js && git commit -m "feat: supabase repo"`

---

### Task 5: API 핸들러 + 로컬 개발 서버

**Files:**
- Create: `api/_handlers.js`, `api/regions/index.js`, `api/regions/[id].js`, `api/places/[naverId]/survey.js`, `api/stats.js`, `scripts/dev-server.js`, `tests/handlers.test.js`

**Interfaces:**
- Consumes: `createRepo`, `computeStats`, `statsToCsv`, `normalizeQuery`, `MESSAGES`.
- Produces: `createHandlers(repo, { now = () => Date.now() } = {}) → { regionsList, regionsCreate, regionGet, regionDelete, surveyPut, statsGet }`. 각 핸들러는 `(req, res)`를 받는 Vercel Node 함수 시그니처(`req.query`, `req.body`, `res.status(n).json(obj)`, `res.setHeader`, `res.send`). 각 `api/*.js`는 `export default` 핸들러에서 `createHandlers(createRepo(getDb()))`를 호출해 위임한다.
- 응답 규약:
  - `POST /api/regions {query}` → 400 `{error:'query required'}` (정규화 후 빈 문자열) / alias 있으면 `{id, status:'ready'}` / 같은 query 지역이 `failed`면 `resetToCollecting` 후 `{id, status:'collecting'}` / 없으면 생성 `{id, status:'collecting'}`. 201 아님, 항상 200.
  - `GET /api/regions` → `{regions: [{id, name, status, error, created_at, stats}]}`; stats는 `computeStats` 결과의 해당 행(없으면 null).
  - `GET /api/regions/:id` → merged면 merged_into로 대체. collecting이고 `created_at`이 3분 이전이면 `failRegion(id, MESSAGES.WORKER_DOWN)` 후 그 상태로 응답. `{region:{id,name,status,error,source_name,polygon,bbox}, places:[...]}` (places는 ready일 때만). 없으면 404.
  - `DELETE /api/regions/:id` → `{ok:true}`.
  - `PUT /api/places/:naverId/survey {status}` → status가 `'yes'|'no'|null` 아니면 400; `{ok:true}`.
  - `GET /api/stats` → `computeStats` JSON; `?format=csv`면 `text/csv; charset=utf-8` + `Content-Disposition: attachment; filename="bple-stats.csv"`.

- [ ] **Step 1: 실패하는 테스트 작성** `tests/handlers.test.js` — 가짜 repo(메모리 Map 기반, 호출 기록)와 가짜 `res`(status/json/setHeader/send 기록)로:

```js
test('POST empty query → 400', async () => { ... regionsCreate({ body: { query: '  ' } }, res); assert.equal(res.statusCode, 400); assert.equal(repo.created.length, 0); });
test('POST known alias returns existing', ...)   // {id: 7, status: 'ready'}
test('POST failed region resets to collecting', ...)
test('GET stale collecting becomes failed with WORKER_DOWN', async () => { now = created_at + 4min ... assert.equal(res.body.region.status, 'failed'); assert.equal(res.body.region.error, MESSAGES.WORKER_DOWN); });
test('GET merged region follows merged_into', ...)
test('PUT survey rejects "maybe"', ...)          // 400
test('GET stats csv sets headers', ...)          // content-type text/csv, body starts with BOM
```

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: `api/_handlers.js` + 4개 라우트 파일 구현.** 라우트 파일은 각 3~5줄.
- [ ] **Step 4: `scripts/dev-server.js` 구현** — `node:http`로 3000 포트. `/api/...` 경로는 `api/` 파일을 동적 import해 Vercel식 `req.query`(동적 세그먼트 `[id]` 매핑, 쿼리스트링), `req.body`(JSON 파싱), `res.status().json()`, `res.send()`를 흉내 내 호출. 그 외는 `public/`에서 정적 파일, `/stats` → `public/stats.html`.
- [ ] **Step 5: 통과 확인** Run: `npm test` → PASS. Run: `npm run dev &` 후 `curl -s localhost:3000/api/stats` → `{"regions":[],"all":{...}}`; `curl -s -X POST localhost:3000/api/regions -H 'content-type: application/json' -d '{"query":"  "}'` → 400.
- [ ] **Step 6: Commit** `git add api scripts tests/handlers.test.js && git commit -m "feat: api handlers and dev server"`

---

### Task 6: Aside REPL 실행기 + Apollo 파서

**Files:**
- Create: `worker/apollo.js`, `worker/aside.js`, `tests/apollo.test.js`, `tests/aside.test.js`, `tests/fixtures/fake-aside.sh`

**Interfaces:**
- Produces:
  - `parseApolloState(scriptText: string): object` — `window.__APOLLO_STATE__` 뒤 첫 `{`부터 중괄호 균형(문자열·이스케이프 인식)으로 잘라 `JSON.parse`. 없으면 `null`. **의존성 없는 순수 함수**여야 한다(`toString()`으로 REPL에 주입).
  - `runRepl(script: string, { bin = process.env.ASIDE_BIN ?? 'aside', profile = process.env.ASIDE_PROFILE, timeoutMs = 125000 }) → Promise<any>` — `spawn(bin, ['repl', '--profile', profile, script])`, stdout에서 `@@RESULT@@`로 시작하는 마지막 줄을 JSON.parse. 없거나 exit≠0이면 `Error('aside repl failed: ' + stdout/stderr 끝 500자)`.
  - `checkAside(opts) → Promise<boolean>` — `runRepl("console.log('@@RESULT@@' + JSON.stringify({ok:1}))")`가 `{ok:1}`이면 true.

- [ ] **Step 1: 실패하는 테스트 작성** `tests/apollo.test.js`

```js
const html = 'x; window.__APOLLO_STATE__ = {"A:1":{"n":"a}b","v":"q\\"z"},"ROOT_QUERY":{}}; window.z=1;';
test('parses balanced object with tricky strings', () => assert.deepEqual(parseApolloState(html), { 'A:1': { n: 'a}b', v: 'q"z' }, ROOT_QUERY: {} }));
test('returns null when absent', () => assert.equal(parseApolloState('nothing'), null));
```

`tests/aside.test.js` — `tests/fixtures/fake-aside.sh`(인자를 무시하고 `echo '[system] noise'; echo '@@RESULT@@{"ok":1,"n":3}'`; 두 번째 모드 `FAKE_FAIL=1`이면 exit 2)로:

```js
test('runRepl parses @@RESULT@@ line', async () => assert.deepEqual(await runRepl('x', { bin: fake, profile: 'p' }), { ok: 1, n: 3 }));
test('runRepl rejects on nonzero exit', async () => assert.rejects(runRepl('x', { bin: fake, profile: 'p' }), /aside repl failed/)); // FAKE_FAIL=1
test('runRepl passes profile and script as argv', ...)   // fake가 argv를 stderr로 echo, 검사
```

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** `worker/apollo.js`, `worker/aside.js` (fixture는 `chmod +x`).
- [ ] **Step 4: 통과 확인** `node --test tests/apollo.test.js tests/aside.test.js` → PASS. 실제 확인: `node -e "import('./worker/aside.js').then(m => m.checkAside().then(console.log))"` → `true` (Aside.app 실행 중일 때).
- [ ] **Step 5: Commit** `git add worker tests && git commit -m "feat: aside repl runner and apollo parser"`

---

### Task 7: 네이버 수집 스크립트 + collectRegion

**Files:**
- Create: `worker/scripts.js`, `worker/collect.js`, `tests/collect.test.js`, `scripts/smoke-collect.js`

**Interfaces:**
- Consumes: `parseApolloState`(소스 주입), `runRepl`, `bboxOfFeature`, `pointInGeometry`, `splitBbox`, repo, `MESSAGES`.
- Produces:
  - `regionScript(query: string): string` — REPL JS. 결과 `@@RESULT@@` JSON: `{ kind: 'adm'|'develope', key, name, feature }` 또는 `{ error: 'no_polygon' }`.
    - 흐름(스펙 4.4): `openTab('https://map.naver.com/p/search/' + encodeURIComponent(query))`, `sleep(5000)`; `page.evaluate`로 performance 리소스 중 `/p/api/polygon?…order=adm` URL 검색 → 있으면 fetch(JSON) → `key = feature.properties.navercode`, `name = area3 || area2`; 없으면 `page.frames().find(f => /pcmap\.place\.naver\.com\/place\/list/.test(f.url()))`의 `evaluate`에 `parseApolloState.toString()`을 붙여 `PlaceListBusinessesItem:*` 중 `poiInfo?.polygon?.shapeKey?.__ref`가 있는 첫 항목 `{ id: __ref.split(':')[1], x, y, name }` → `fetch('https://map.naver.com/p/api/polygon?lng=&lat=&order=develope&keyword=')` → `key = id`. 둘 다 없으면 `{error:'no_polygon'}`.
  - `placesScript(bbox, { maxLeaves = 24, maxDepth = 5 } = {}): string` — 결과 `{ items: Item[], leaves }` 또는 `{ error: 'too_wide' }`. `Item = { naver_id: id, name, category, road_address: roadAddress, address, phone, lng: +x, lat: +y }`. BFS 큐로 bbox 처리: 탭 하나를 `openTab`으로 열고 이후 `page.goto(url)` + `sleep(800)`; `document.scripts`에서 `__APOLLO_STATE__` 텍스트를 파싱해 `ROOT_QUERY`의 `placeList(` 키 중 `"display":100`이 들어간 것의 `businesses.total`을 읽는다. total > 100이고 depth < maxDepth면 `splitBbox` 4개를 큐에 넣고(이 노드는 잎으로 세지 않음), 아니면 `PlaceListBusinessesItem:*`를 모은다(광고 `RestaurantAdSummary`는 키가 다르므로 자동 제외). 잎 수가 maxLeaves를 넘으면 즉시 `{error:'too_wide'}`. 경과 100초를 넘어도 `too_wide`. `naver_id` 중복 제거는 Node에서.
  - `collectRegion(repo, region, { runRepl }) → Promise<void>` —
    1. `r = await runRepl(regionScript(region.query))`; `r.error === 'no_polygon'` → `failRegion(id, MESSAGES.NO_POLYGON)` 후 return.
    2. `source_key = kind + ':' + key`; `existing = findRegionBySourceKey(source_key)` 있으면 `mergeRegion(id, existing.id, region.query)` 후 return.
    3. `bbox = bboxOfFeature(feature)`; `setRegionPolygon(id, { source_kind: kind, source_key, source_name: name, polygon: feature.geometry, bbox, name: region.query })`.
    4. `p = await runRepl(placesScript(bbox))`; `p.error === 'too_wide'` → `failRegion(id, MESSAGES.TOO_WIDE)`.
    5. 중복 제거 → `pointInGeometry([lng,lat], feature.geometry)` 통과분만 → `upsertPlaces` → `linkPlaces` → `markReady` → `upsertAlias(query, id)`.
    6. 예외는 `failRegion(id, '수집 중 오류: ' + message 앞 200자)`.

- [ ] **Step 1: 실패하는 테스트 작성** `tests/collect.test.js` — 가짜 repo(호출 기록)와 가짜 `runRepl`(스크립트 문자열에 `api/polygon` 포함 여부로 지역/식당 호출을 구분해 준비된 응답 반환):

```js
test('no_polygon → failRegion with NO_POLYGON', ...)
test('existing source_key → mergeRegion, no places call', ...)
test('too_wide → failRegion with TOO_WIDE', ...)
test('happy path filters outside points, dedupes, marks ready, aliases', async () => {
  // feature: 0..10 정사각형, items: (5,5) id a, (5,5) id a 중복, (50,50) id b
  // 기대: upsertPlaces에 a만, linkPlaces(id,['a']), markReady, upsertAlias(query,id)
});
test('thrown error → failRegion with 수집 중 오류', ...)
test('regionScript contains query and adm/develope urls', () => { const s = regionScript('동성로'); assert.ok(s.includes(encodeURIComponent('동성로'))); assert.ok(s.includes('order=develope')); assert.ok(s.includes('order=adm')); assert.ok(s.includes('function parseApolloState')); });
test('placesScript embeds bbox and limits', () => { const s = placesScript([1,2,3,4]); assert.ok(s.includes('1%3B2%3B3%3B4') || s.includes('[1,2,3,4]')); assert.ok(s.includes('24')); });
```

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: `worker/scripts.js`, `worker/collect.js` 구현** → `node --test tests/collect.test.js` PASS
- [ ] **Step 4: 실제 네이버 스모크** `scripts/smoke-collect.js <query>` — repo 없이 `runRepl(regionScript(q))` 결과의 `kind,key,name,bbox`와 `runRepl(placesScript(bbox))`의 `items.length, leaves`, 폴리곤 안 개수를 출력.

Run: `node scripts/smoke-collect.js 동성로` → `kind=develope key=3696089 name=동성로로데오거리`, items > 50, 안쪽 개수 > 30, 120초 이내.
Run: `node scripts/smoke-collect.js "대구 중구 삼덕동"` → `kind=adm key=06110545`, leaves ≥ 4, 안쪽 개수 > 300.
Run: `node scripts/smoke-collect.js 교동` → `no_polygon`.

- [ ] **Step 5: Commit** `git add worker scripts tests && git commit -m "feat: naver collection scripts and collectRegion"`

---

### Task 8: 워커 루프 + 엔드투엔드

**Files:**
- Create: `worker/index.js`

**Interfaces:**
- Consumes: `checkAside`, `runRepl`, `createRepo(getDb())`, `collectRegion`.
- Produces: `npm run worker`. 시작 시 `checkAside()` false면 `Aside 브라우저에 연결할 수 없습니다. open -a Aside 후 다시 실행하세요.` 출력 후 exit 1. 이후 3초 간격 `nextCollecting()` → 있으면 `collectRegion` (동시 1건), 각 단계 한 줄 로그(`[worker] 동성로 → ready (123 places, 41s)`). SIGINT로 종료.

- [ ] **Step 1: `worker/index.js` 구현** (테스트는 Task 7의 collectRegion이 담당; 루프 자체는 아래 E2E로 검증).
- [ ] **Step 2: E2E** 터미널 1: `npm run dev`; 터미널 2: `npm run worker`. 그리고:

```bash
curl -s -X POST localhost:3000/api/regions -H 'content-type: application/json' -d '{"query":"동성로"}'   # {"id":N,"status":"collecting"}
sleep 90; curl -s localhost:3000/api/regions/N | head -c 400                                                # "status":"ready", places 배열
curl -s -X POST localhost:3000/api/regions -H 'content-type: application/json' -d '{"query":" 동성로 "}'   # 같은 id, ready
curl -s -X PUT localhost:3000/api/places/<naver_id>/survey -H 'content-type: application/json' -d '{"status":"yes"}'
curl -s localhost:3000/api/stats                                                                            # yes:1
```

- [ ] **Step 3: Commit** `git add worker/index.js && git commit -m "feat: collection worker loop"`

---

### Task 9: 지도 화면 (네이버 지도풍 UI)

**Files:**
- Create: `public/index.html`, `public/style.css`, `public/app.js`

**Interfaces:**
- Consumes: Task 5 API. Leaflet 1.9.4 CDN(unpkg) CSS/JS.
- Produces: 스펙 4.5 "지도 화면" 그대로. 핵심 DOM id: `#search-input`, `#search-clear`, `#panel`, `#region-head`, `#filter-chips`(버튼 `data-filter="all|none|yes|no"`), `#place-list`, `#map`, `#sheet`(팝오버/하단 시트, 버튼 `#btn-yes`, `#btn-no`), `#recent-regions`.
- 동작:
  - Enter 또는 검색 버튼 → `POST /api/regions` → id 저장(`location.hash = '#r=' + id`) → `collecting`이면 2초 폴링(`GET /api/regions/:id`) + "네이버 지도에서 수집 중… (30초~2분)"; `failed`면 빨간 문구(`region.error`) + "다시 시도" 버튼(POST 재호출); `ready`면 렌더.
  - 렌더: 폴리곤 `L.geoJSON(geometry, { style: { color: 'rgb(57,133,247)', weight: 2, fillColor: 'rgb(56,229,255)', fillOpacity: 0.15 } })`, `map.fitBounds`. 핀은 `L.divIcon` (클래스 `pin pin-none|pin-yes|pin-no`), 가능 핀에는 `.pin-ring` 자식 요소(CSS `@keyframes pulse` 1s infinite, `#39ff14`, opacity 1→0.2, scale 1→1.6).
  - 목록 항목·핀 클릭 → `#sheet` 열기(이름, 업종, 도로명주소, 전화) + 가능/불가능 버튼. 누르면 `PUT survey`(같은 값 다시 누르면 null) → 로컬 상태 갱신 → 핀·목록·헤더 숫자 즉시 반영.
  - 10초마다 `GET /api/regions/:id` 재요청해 survey만 갱신(지도 이동 없음).
  - 필터 칩: 목록과 핀 모두에 적용.
  - 초기 화면(검색 전): `GET /api/regions` 결과를 `#recent-regions`에 이름·상태·"식당 N · 조사 M" 형태로.
  - 모바일(`max-width: 768px`): 지도 전체 화면, 패널은 하단 시트(상단 여백 56px 검색창 고정, 손잡이 바로 접기/펴기), 버튼 높이 ≥ 48px.
  - 스타일: 네이버 지도 PC 패널 폭 380px, 검색창 테두리 `#03c75a` 2px 둥근 모서리, 이름 링크색 `#0068c3`, 업종 회색 `#8f8f8f`, 폰트 시스템 산세리프.

- [ ] **Step 1: 마크업·CSS·JS 작성** (3개 파일).
- [ ] **Step 2: 데스크톱 확인** `npm run dev` 실행 중, Aside REPL로 스크린샷:

```
aside repl --profile $ASIDE_PROFILE "const p = await openTab('http://localhost:3000/#r=N'); await p.setViewportSize({width:1400,height:900}); await sleep(4000); await p.screenshot({path:'./desk.png'}); console.log(pwd)"
```
PNG를 열어 대조: 왼쪽 패널·검색창·목록, 오른쪽 지도에 파란 폴리곤과 핀, 헤더 숫자. 핀 하나 클릭 후 가능 버튼을 눌러 다시 스크린샷 → 형광 링이 보인다.

- [ ] **Step 3: 모바일 확인** viewport `{width:390,height:844}`로 같은 절차 → 지도 전체, 하단 시트, 48px 버튼.
- [ ] **Step 4: Commit** `git add public && git commit -m "feat: naver-style survey map UI"`

---

### Task 10: 통계 화면

**Files:**
- Create: `public/stats.html`, `public/stats.js`
- Modify: `public/index.html` (헤더에 "통계" 링크), `public/style.css`

**Interfaces:**
- Consumes: `GET /api/stats`, `DELETE /api/regions/:id`, `GET /api/stats?format=csv`.
- Produces: 표(열: 지역, 식당 수, 조사 완료, 진행률(%), 가능, 불가능, 가맹률(%), 삭제), 마지막 행 합계(굵게), 표 아래 문구 `합계는 여러 구획에 겹치는 식당을 한 번만 셉니다`, "CSV 다운로드" 링크(`/api/stats?format=csv`), 지역 이름 → `/#r=<id>` 링크. 삭제 버튼 → `prompt('삭제하려면 지역 이름을 입력하세요')` 값이 이름과 같을 때만 DELETE 후 표 다시 로드. null 퍼센트는 "–".

- [ ] **Step 1: 작성.**
- [ ] **Step 2: 확인** 브라우저(Aside 스크린샷) `http://localhost:3000/stats` → 표에 동성로 행과 합계 행, `curl -sI 'localhost:3000/api/stats?format=csv' | grep -i content-` → text/csv + attachment.
- [ ] **Step 3: Commit** `git add public && git commit -m "feat: stats page with csv and delete"`

---

### Task 11: Vercel 배포 + README

**Files:**
- Create: `README.md`
- Modify: `vercel.json` (필요 시)

- [ ] **Step 1: README 작성** — 스펙 4.6 "실행 방법" 내용을 그대로. 추가로 `.env` 예시(값 없이 키 이름만), Aside 프로필 확인법(`aside host profiles`), 실패 메시지 세 가지의 뜻.
- [ ] **Step 2: Vercel 프로젝트를 GitHub 저장소에 연결하고 환경변수 설정**

```bash
vercel link --yes                      # 프로젝트 이름 bplepay
vercel git connect https://github.com/maclovedany/bplepay.git   # main 푸시 → 자동 production 배포
printf '%s' "$SUPABASE_URL" | vercel env add SUPABASE_URL production
printf '%s' "$SUPABASE_SERVICE_ROLE_KEY" | vercel env add SUPABASE_SERVICE_ROLE_KEY production
git push                                # 자동 배포 트리거
```

`vercel git connect`가 GitHub 앱 권한 때문에 실패하면 Vercel 대시보드 > 프로젝트 > Settings > Git에서 저장소를 연결하도록 사용자에게 요청한다. 확인: `vercel ls bplepay` 또는 `gh api repos/maclovedany/bplepay/deployments`에 새 배포가 보인다.

- [ ] **Step 3: 배포 확인** `curl -s https://<배포주소>/api/stats` → JSON; 휴대폰 크기 뷰포트로 `https://<배포주소>/#r=N` 스크린샷(Aside) → 지도·핀 표시. 워커가 켜진 상태에서 배포 주소로 새 지역("대구 중구 삼덕동") 검색 → ready. 마지막으로 README를 고쳐 푸시한 뒤 자동 배포가 도는지(`vercel ls bplepay`에 새 항목) 확인한다.
- [ ] **Step 4: Commit** `git add README.md vercel.json && git commit -m "docs: readme and deploy"`

---

### Task 12: AI 판단 층 (Gemini) — 2026-11-03 추가 (스펙 7절)

**Files:**
- Create: `lib/gemini.js`, `worker/agent.js`, `supabase/migrations/2026-11-03-ai-agent.sql`, `tests/gemini.test.js`, `tests/agent.test.js`
- Modify: `worker/scripts.js`(후보 목록+폴리곤 일괄 수신), `worker/collect.js`(interpretQuery → chooseCandidate → suggestNarrower), `lib/repo.js`(`setRegionAi`, `failRegion(id, error, {suggestions})`), `api/_handlers.js`(`search_query, ai_note, suggestions` 노출), `public/`(AI 해석 표시, 제안 버튼), `scripts/smoke-collect.js`, `tests/collect.test.js`, `tests/handlers.test.js`, `tests/repo.integration.test.js`

**Interfaces:**
- `askJson({system, user, schema, temperature}, {apiKey, model, fetchImpl, timeoutMs}) → Promise<object>` — Gemini `generateContent`, `responseMimeType: application/json`, 실패 시 throw.
- `createAgent({askJson, context, log}) → { interpretQuery(raw) → {query, note|null}, chooseCandidate(raw, candidates) → {index, reason|null}, suggestNarrower(raw, regionName) → string[] }` — 모든 메서드는 실패 시 기본값(raw / 0 / []).
- `regionScript` 결과: adm 는 그대로 `{kind:'adm', key, name, feature}`; develope 는 `{kind:'develope', candidates:[{id,x,y,name,category,address}], features:{[id]: feature|null}}`.
- `pickPolygon(r, rawQuery, agent, log) → {kind,key,name,feature}|null` (collect.js export).

- [ ] Step 1: `tests/gemini.test.js`, `tests/agent.test.js` 실패 확인 → `lib/gemini.js`, `worker/agent.js` 구현 → PASS (9)
- [ ] Step 2: `tests/collect.test.js`에 해석·후보 선택·제안 저장 3건, `tests/handlers.test.js`에 필드 노출 1건, 통합 테스트에 `setRegionAi`/`suggestions` 추가 → RED → 구현 → PASS
- [ ] Step 3: 사용자가 `supabase/migrations/2026-11-03-ai-agent.sql` 실행 → `npm test` 전체 PASS
- [ ] Step 4: `node scripts/smoke-collect.js 동성로` → `agent: "동성로" → "대구 중구 동성로"`, 후보 목록, 588곳. 워커 재시작 후 배포 주소에서 "교동" 검색 → 화면에 "AI 해석" 표시; 넓은 지역 검색 → 실패 화면에 제안 버튼.
- [ ] Step 5: Commit, push, 문서 갱신(spec 7절, README, architecture.md, 단계별프롬프트.md 16단계)


### Task 14: 공공데이터 대체 수집 (설계서 8절)

**Files:** Create `worker/publicdata.js`, `tests/publicdata.test.js`; Modify `lib/geo.js` (`convexHull`), `worker/agent.js` (`pickRoad`), `worker/scripts.js` (no_polygon 에 `center`), `worker/collect.js`, `api/_handlers.js` (`source_kind` 노출), `public/app.js`, `scripts/smoke-collect.js`, 테스트들.

**Interfaces:**
- `convexHull(points: [lng,lat][]) → Polygon geometry` — 점 3개 미만이면 bbox 를 0.0003도 넓힌 사각형.
- `normalizeStore(raw) → {naver_id: bizesId, name, category, road_address, address, phone: null, lng, lat, road, road_code}`; `shortRoad('대구광역시 중구 중앙대로') → '중앙대로'`.
- `fetchFoodStores({cx, cy, radius}, {key, fetchImpl, pageSize=1000, maxPages=5}) → Promise<store[]>`; `createPublicData({key}) → {enabled, fetchFoodStores, stdrYm}`.
- `agent.pickRoad(raw, roads: string[]) → {index: number|null, reason}`.
- `regionScript` no_polygon 결과: `{error:'no_polygon', center:{x,y}|null}`.
- `collectRegion(repo, region, {runRepl, log, agent, publicData})`.

- [ ] Step 1: `tests/geo.test.js`(convexHull 2건), `tests/publicdata.test.js`(normalize·shortRoad·페이지·오류 4건), `tests/agent.test.js`(pickRoad 2건), `tests/collect.test.js`(도로/반경/빈 결과/키 없음 4건), `tests/handlers.test.js`(source_kind 1건) → RED
- [ ] Step 2: 구현 → `node --test "tests/**/*.test.js"` PASS
- [ ] Step 3: `node scripts/smoke-collect.js 중앙로` → `public: road 중앙대로, N stores`; 워커 재시작 후 배포 주소에서 "중앙로" 검색 → 점선 구획과 핀, 안내 문구
- [ ] Step 4: Commit, push, 문서(README, architecture.md, 단계별프롬프트.md 20단계)
