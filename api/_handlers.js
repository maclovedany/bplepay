import { normalizeQuery } from '../lib/normalize.js';
import { computeStats, statsToCsv } from '../lib/stats.js';
import { MESSAGES } from '../lib/messages.js';

const WAIT_MS = 3 * 60 * 1000;     // 워커가 집어 가지 않은 채 3분 → 워커가 꺼진 것으로 본다
const RUN_MS = 5 * 60 * 1000;      // 집어 간 뒤 5분 → 수집 중 죽은 것으로 본다
const SURVEY_VALUES = new Set(['yes', 'no', null]);

const publicRegion = (r) => ({
  id: r.id, name: r.name, status: r.status, error: r.error ?? null,
  source_name: r.source_name ?? null, polygon: r.polygon ?? null, bbox: r.bbox ?? null, created_at: r.created_at,
  search_query: r.search_query ?? null, ai_note: r.ai_note ?? null, suggestions: Array.isArray(r.suggestions) ? r.suggestions : [],
  ai_excluded: r.ai_excluded ?? null,
});

export function createHandlers(repo, { now = () => Date.now() } = {}) {
  return {
    async regionsList(req, res) {
      const [regions, input] = await Promise.all([repo.listRegions(), repo.statsInput()]);
      const stats = computeStats(input.regions, input.links, input.surveys);
      const byId = new Map(stats.regions.map((s) => [s.id, s]));
      res.status(200).json({
        regions: regions.map((r) => ({ id: r.id, name: r.name, status: r.status, error: r.error ?? null, created_at: r.created_at, stats: byId.get(r.id) ?? null })),
      });
    },

    async regionsCreate(req, res) {
      const query = normalizeQuery(req.body?.query);
      if (!query) return res.status(400).json({ error: 'query required' });
      const alias = await repo.findAlias(query);
      if (alias) {
        const r = await repo.getRegion(alias.region_id);
        if (r) return res.status(200).json({ id: r.id, status: r.status });
      }
      const existing = await repo.findRegionByQuery(query);
      if (existing) {
        const orphanMerge = existing.status === 'merged' && !existing.merged_into;
        if (existing.status === 'failed' || orphanMerge) {
          await repo.resetToCollecting(existing.id);
          return res.status(200).json({ id: existing.id, status: 'collecting' });
        }
        const target = existing.status === 'merged' && existing.merged_into ? await repo.getRegion(existing.merged_into) : existing;
        return res.status(200).json({ id: target.id, status: target.status });
      }
      const created = await repo.createRegion({ query, name: query });
      res.status(200).json({ id: created.id, status: created.status });
    },

    async regionGet(req, res) {
      const id = Number(req.query.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
      let region = await repo.getRegion(id);
      if (region && region.status === 'merged') region = region.merged_into ? await repo.getRegion(region.merged_into) : null;
      if (!region) return res.status(404).json({ error: '지역을 찾을 수 없습니다. 다시 검색해 주세요.' });
      if (region.status === 'collecting') {
        const t = now();
        let error = null;
        if (!region.started_at && t - Date.parse(region.created_at) > WAIT_MS) error = MESSAGES.WORKER_DOWN;
        else if (region.started_at && t - Date.parse(region.started_at) > RUN_MS) error = '수집 중 오류: 시간 초과. 다시 시도해 주세요.';
        if (error) {
          await repo.failRegion(region.id, error);
          region = { ...region, status: 'failed', error };
        }
      }
      const out = { region: publicRegion(region), filter: null };
      const q = normalizeQuery(req.query.q);
      if (q) {
        const alias = await repo.findAlias(q);
        if (alias?.want && Array.isArray(alias.categories)) out.filter = { want: alias.want, categories: alias.categories };
      }
      if (region.status === 'ready') out.places = await repo.getRegionPlaces(region.id);
      res.status(200).json(out);
    },

    async regionDelete(req, res) {
      const id = Number(req.query.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
      await repo.deleteRegion(id);
      res.status(200).json({ ok: true });
    },

    async surveyPut(req, res) {
      const status = req.body?.status ?? null;
      if (!SURVEY_VALUES.has(status)) return res.status(400).json({ error: 'status must be yes, no or null' });
      await repo.setSurvey(String(req.query.naverId), status);
      res.status(200).json({ ok: true });
    },

    async statsGet(req, res) {
      const input = await repo.statsInput();
      const stats = computeStats(input.regions, input.links, input.surveys);
      if (req.query?.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="bple-stats.csv"');
        return res.status(200).send(statsToCsv(stats));
      }
      res.status(200).json(stats);
    },
  };
}
