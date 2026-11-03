-- 공공데이터(소상공인 상가정보) 대체 수집: source_kind 에 'public' 허용
alter table regions drop constraint if exists regions_source_kind_check;
alter table regions add constraint regions_source_kind_check check (source_kind in ('develope','adm','public'));
