function tally(naverIds, surveyMap) {
  let surveyed = 0, yes = 0, no = 0;
  for (const id of naverIds) {
    const s = surveyMap.get(id);
    if (!s) continue;
    surveyed++;
    if (s === 'yes') yes++;
    else if (s === 'no') no++;
  }
  const total = naverIds.size;
  return {
    total,
    surveyed,
    progress: total ? surveyed / total : null,
    yes,
    no,
    rate: surveyed ? yes / surveyed : null,
  };
}

export function computeStats(regions, links, surveys) {
  const surveyMap = new Map(surveys.map((s) => [s.naver_id, s.status]));
  const byRegion = new Map();
  const all = new Set();
  for (const l of links) {
    if (!byRegion.has(l.region_id)) byRegion.set(l.region_id, new Set());
    byRegion.get(l.region_id).add(l.naver_id);
    all.add(l.naver_id);
  }
  return {
    regions: regions.map((r) => ({ id: r.id, name: r.name, ...tally(byRegion.get(r.id) ?? new Set(), surveyMap) })),
    all: { name: '합계', ...tally(all, surveyMap) },
  };
}

const pct = (v) => (v == null ? '' : (v * 100).toFixed(1));
const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

export function statsToCsv(stats) {
  const header = '지역,식당 수,조사 완료,진행률(%),가능,불가능,가맹률(%)';
  const row = (s) => [csvCell(s.name), s.total, s.surveyed, pct(s.progress), s.yes, s.no, pct(s.rate)].join(',');
  return '﻿' + [header, ...stats.regions.map(row), row(stats.all)].join('\n');
}
