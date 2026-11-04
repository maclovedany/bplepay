import { normalizeQuery } from '../lib/normalize.js';
import { computeStats, statsToCsv } from '../lib/stats.js';
import { MESSAGES } from '../lib/messages.js';

const WAIT_MS = 3 * 60 * 1000;     // 워커가 집어 가지 않은 채 3분 → 워커가 꺼진 것으로 본다
const RUN_MS = 10 * 60 * 1000;     // 집어 간 뒤 10분(식당 호출 최대 4번 × 2분 + 여유) → 수집 중 죽은 것으로 본다
const REACTION_VALUES = new Set(['like', 'dislike', null]);
const SURVEY_VALUES = new Set(['yes', 'no', null]);
const VIEW_LIMIT = 3000;            // 지도 화면 안 식당을 한 번에 이만큼까지 보낸다. 넘으면 확대해 달라고 한다.

const publicRegion = (r) => ({
  id: r.id, name: r.name, status: r.status, error: r.error ?? null,
  source_name: r.source_name ?? null, source_kind: r.source_kind ?? null, polygon: r.polygon ?? null, bbox: r.bbox ?? null, created_at: r.created_at,
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

    // 첫 화면: 지도에 보이는 범위(bbox=minLng,minLat,maxLng,maxLat) 안의 이미 수집된 식당
    async placesInView(req, res) {
      const bbox = String(req.query.bbox ?? '').split(',').map(Number);
      const [minLng, minLat, maxLng, maxLat] = bbox;
      if (bbox.length !== 4 || !bbox.every(Number.isFinite) || minLng > maxLng || minLat > maxLat) {
        return res.status(400).json({ error: 'bbox must be minLng,minLat,maxLng,maxLat' });
      }
      const { places, truncated } = await repo.getPlacesInBbox(bbox, VIEW_LIMIT);
      res.status(200).json({ places, truncated });
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

    // 좋아요/싫어요. 로그인이 없으니 브라우저가 만든 device_id 로 기기당 하나만 센다.
    async reactionPut(req, res) {
      const kind = req.body?.kind ?? null;
      const deviceId = typeof req.body?.device_id === 'string' ? req.body.device_id.trim().slice(0, 64) : '';
      if (!REACTION_VALUES.has(kind)) return res.status(400).json({ error: 'kind must be like, dislike or null' });
      if (!deviceId) return res.status(400).json({ error: 'device_id required' });
      const counts = await repo.setReaction(String(req.query.naverId), deviceId, kind);
      res.status(200).json(counts);
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
