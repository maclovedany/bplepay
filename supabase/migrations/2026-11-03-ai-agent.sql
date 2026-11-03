-- 2026-11-03 AI 판단 층: 검색어 해석 결과와 실패 시 하위 지역 제안을 저장한다.
alter table regions add column if not exists search_query text;   -- 모델이 고친 네이버 검색어
alter table regions add column if not exists ai_note text;        -- 해석 이유 한 줄
alter table regions add column if not exists suggestions jsonb;   -- 실패 시 제안 검색어 목록
