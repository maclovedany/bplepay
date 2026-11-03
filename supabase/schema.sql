-- 비플페이 가맹점 현장조사 지도 — Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 붙여 넣고 실행한다.

create table if not exists regions (
  id bigint generated always as identity primary key,
  query text not null,
  name text not null,
  source_kind text check (source_kind in ('develope','adm','public')),  -- public: 공공데이터(소상공인 상가정보)로 수집
  source_key text unique,
  source_name text,
  polygon jsonb,
  bbox double precision[],
  status text not null default 'collecting' check (status in ('collecting','ready','failed','merged')),
  merged_into bigint references regions(id) on delete set null,
  error text,
  created_at timestamptz not null default now(),   -- 마지막으로 수집을 요청한 때 (재시도 시 갱신)
  started_at timestamptz,                          -- 워커가 집어 간 때
  search_query text,                               -- AI 가 고친 네이버 검색어
  ai_note text,                                    -- 해석 이유 한 줄
  suggestions jsonb,                               -- 실패 시 AI 가 제안한 검색어 목록
  ai_excluded jsonb                                -- AI 가 제외한 비식당 업종 {categories, count}
);

create table if not exists region_aliases (
  query text primary key,
  region_id bigint not null references regions(id) on delete cascade,
  want text,                                       -- 자연어 검색에서 원한 업종 ("한식집")
  categories jsonb                                 -- 그에 맞는 네이버 업종 목록
);

create table if not exists places (
  naver_id text primary key,
  name text not null,
  category text,
  road_address text,
  address text,
  phone text,
  lng double precision not null,
  lat double precision not null,
  created_at timestamptz not null default now()
);

create table if not exists region_places (
  region_id bigint references regions(id) on delete cascade,
  naver_id text references places(naver_id),
  primary key (region_id, naver_id)
);

create table if not exists surveys (
  naver_id text primary key references places(naver_id),
  status text not null check (status in ('yes','no')),
  updated_at timestamptz not null default now()
);

create index if not exists regions_status_idx on regions(status, created_at);

alter table regions enable row level security;
alter table region_aliases enable row level security;
alter table places enable row level security;
alter table region_places enable row level security;
alter table surveys enable row level security;
