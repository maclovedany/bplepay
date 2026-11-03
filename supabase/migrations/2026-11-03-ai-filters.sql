-- 2026-11-03 AI 업종 필터: 식당이 아닌 업종 제외 기록 + 자연어 검색("을지로 근처 한식집")의 업종 필터
alter table regions add column if not exists ai_excluded jsonb;          -- {categories: [...], count: N}
alter table region_aliases add column if not exists want text;           -- 조사원이 원한 업종 표현 ("한식집")
alter table region_aliases add column if not exists categories jsonb;    -- 그 표현에 맞는 네이버 업종 목록
