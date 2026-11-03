-- 좋아요/싫어요: 기기(브라우저)마다 식당 하나에 하나. 로그인이 없으므로 device_id 는 브라우저가 만든 임의 문자열.
create table if not exists reactions (
  naver_id text not null references places(naver_id) on delete cascade,
  device_id text not null,
  kind text not null check (kind in ('like','dislike')),
  created_at timestamptz not null default now(),
  primary key (naver_id, device_id)
);
alter table reactions enable row level security;
