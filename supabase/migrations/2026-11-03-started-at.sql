-- 2026-11-03 리뷰 반영: 워커가 집어 간 시각. 처음 schema.sql 을 이미 실행한 프로젝트는 이 파일만 SQL Editor 에서 실행한다.
alter table regions add column if not exists started_at timestamptz;
