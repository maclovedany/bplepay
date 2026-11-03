# 비플페이 가맹점 현장조사 지도

지역 이름을 입력하면 네이버 지도의 구획과 그 안의 식당이 자동으로 수집되고, 조사원이 식당마다 "비플페이 가능 / 불가능"을 눌러 저장하며, 지역별 가맹 통계를 보는 웹 서비스.

```
[조사원 휴대폰/노트북] → [Vercel: public/ 화면 + api/ 서버리스] → [Supabase Postgres] ← [이 Mac: worker/ 수집 워커 → Aside 브라우저 → map.naver.com]
```

- 설계: `docs/superpowers/specs/2026-11-03-bple-survey-map-design.md`
- 구현 계획: `docs/superpowers/plans/2026-11-03-bple-survey-map.md`
- 실습용 프롬프트: `단계별프롬프트.md`

## 최초 1회 설정

1. **Supabase**: 프로젝트를 만들고 SQL Editor에서 `supabase/schema.sql`을 실행한다. (서비스롤 키로는 표를 만들 수 없어 사람이 직접 실행해야 한다.)
2. **GitHub + Vercel**: 소스는 `github.com/maclovedany/bplepay`에 있고 Vercel 프로젝트 `bplepay`가 이 저장소에 연결되어 있다. `main`에 푸시하면 자동 배포된다. Vercel 환경변수에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`가 들어 있어야 한다.
3. **이 Mac의 `.env`** (저장소에 올리지 않는다):

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ASIDE_PROFILE=<aside host profiles 에서 connected 인 프로필 ID>
GEMINI_API_KEY=AIza...            # AI 판단 층 (Google AI Studio 에서 발급)
# GEMINI_MODEL=gemini-3.5-flash-lite   # 선택. 기본값
# SURVEY_CONTEXT=대구광역시에서 진행하는 비플페이(대구로페이) 가맹점 현장조사   # 선택
```

`supabase/migrations/*.sql` 도 순서대로 SQL Editor 에서 실행한다(열 추가).

4. **Aside**: https://aside.com 의 Aside 브라우저와 CLI(`curl -fsSL https://releases.aside.com/install.sh | bash`)를 설치한다. Aside 계정 로그인은 필요 없다.

## 조사하는 날마다 (이 Mac에서)

```bash
open -a Aside        # Aside 브라우저 실행
npm run worker       # 수집 워커. 시작할 때 Aside 연결을 확인하고 실패하면 종료한다.
```

조사원은 Vercel 배포 주소로 접속한다. 새 지역을 수집할 때만 워커가 켜져 있으면 되고, 이미 수집된 지역에 가능/불가능을 입력하는 것은 워커가 꺼져 있어도 된다.

## 로컬 개발

```bash
npm install
npm run dev          # http://localhost:3000 — public/ 와 api/ 를 Vercel 식으로 띄운다
npm test             # 단위 테스트 + Supabase 통합 테스트(.env 없으면 skip)
node scripts/smoke-collect.js "대구 중구 삼덕동"   # DB 없이 네이버 수집만 돌려 본다
```

## 화면에 뜨는 실패 메시지

| 문구 | 뜻 | 대처 |
|---|---|---|
| 구획 정보를 찾지 못했습니다. '대구 중구 삼덕동'처럼 동 이름으로 검색해 보세요. | 네이버 검색 결과에 폴리곤이 붙은 항목이 없다 | 시·구를 붙인 동 이름이나 거리 이름으로 다시 검색 |
| 범위가 너무 넓습니다. 동이나 거리 이름으로 검색해 주세요. | 식당 목록 호출 4번(각 100초)으로도 구획을 다 못 긁었다 (구 단위 이상) | 더 좁은 지역 이름으로 |
| 수집 워커가 꺼져 있습니다. 관리자에게 알려 주세요. | 3분이 지나도 워커가 처리하지 않았다 | Mac에서 `npm run worker` 실행 후 "다시 시도" |
| 수집 중 오류: 시간 초과. 다시 시도해 주세요. | 워커가 집어 간 뒤 10분이 지나도 끝나지 않았다 (워커가 중간에 죽음) | 워커 재시작 후 "다시 시도" |

## AI 판단 층

워커가 Gemini(`gemini-3.5-flash-lite`)에게 세 가지를 맡긴다. 모델이 실패하면 기본 동작으로 돌아간다.

- 검색어 해석: "교동" → "대구 중구 교동" (화면에 "AI 해석"으로 표시)
- 구획 후보 선택: 폴리곤이 붙은 후보가 여럿일 때 하나 고르기
- 범위 초과 시 더 좁은 지역 제안: 실패 화면에 버튼으로 표시
- 식당이 아닌 업종 제외: 미용실·학원·방탈출카페 등은 저장하지 않고 화면에 제외 내역 표시
- 자연어 업종 검색: "을지로 근처 한식집" → 지역 수집 후 한식 계열 업종만 보여 주는 "AI 필터" 칩

구조 설명은 `architecture.md`(비개발자용)를 보라.

## 네이버 지도 접근 경로 (비공식, 바뀔 수 있음)

- 구획 폴리곤: `https://map.naver.com/p/api/polygon?lng=&lat=&order=develope|adm&keyword=` → GeoJSON MultiPolygon
- 식당 목록: `https://pcmap.place.naver.com/restaurant/list?query=음식점&bounds=minx;miny;maxx;maxy&display=100` 페이지의 인라인 `window.__APOLLO_STATE__`
- 한 번에 최대 100곳이라 구획 bbox 를 4분할하며 긁는다. 결과가 하나도 없는 작은 상자는 네이버가 bounds 를 무시하고 전국 검색(total 90만)으로 답하므로, 상자 안에 든 결과가 0이면 빈 잎으로 본다. pcmap 탭 하나에서 같은 출처 `fetch` 로 HTML 만 받아 파싱하고(잎당 0.5초), 100초 예산이 끝나면 남은 상자를 `pending` 으로 돌려 워커가 최대 4번 이어 부른다.
- 자세한 흐름은 `worker/scripts.js`와 설계서 4.4절.

## 통계 정의

진행률 = 조사 완료 ÷ 식당 수. 가맹률 = 가능 ÷ 조사 완료. 합계 행은 여러 구획에 겹치는 식당을 한 번만 센다. `/api/stats?format=csv`로 엑셀용 CSV(BOM 포함)를 받을 수 있다.
