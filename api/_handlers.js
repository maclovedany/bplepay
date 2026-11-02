import { normalizeQuery } from '../lib/normalize.js';
import { computeStats, statsToCsv } from '../lib/stats.js';
import { MESSAGES } from '../lib/messages.js';

const STALE_MS = 3 * 60 * 1000;
const SURVEY_VALUES = new Set(['yes', 'no', null]);

const publicRegion = (r) => ({
  id: r.id, name: r.name, status: r.status, error: r.error ?? null,
  source_name: r.source_name ?? null, polygon: r.polygon ?? null, bbox: r.bbox ?? null, created_at: r.created_at,
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
        if (existing.status === 'failed') {
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
      let region = await repo.getRegion(Number(req.query.id));
      if (region && region.status === 'merged' && region.merged_into) region = await repo.getRegion(region.merged_into);
      if (!region) return res.status(404).json({ error: 'not found' });
      if (region.status === 'collecting' && now() - Date.parse(region.created_at) > STALE_MS) {
        await repo.failRegion(region.id, MESSAGES.WORKER_DOWN);
        region = { ...region, status: 'failed', error: MESSAGES.WORKER_DOWN };
      }
      const out = { region: publicRegion(region) };
      if (region.status === 'ready') out.places = await repo.getRegionPlaces(region.id);
      res.status(200).json(out);
    },

    async regionDelete(req, res) {
      await repo.deleteRegion(Number(req.query.id));
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
