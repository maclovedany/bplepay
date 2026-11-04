// Supabase 접근은 전부 여기서만 한다. source_key 는 "kind:key" 형식.

const REGION_LIST_COLS = 'id,query,name,source_kind,source_key,source_name,bbox,status,merged_into,error,created_at,started_at,search_query,ai_note,suggestions,ai_excluded';

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// PostgREST 는 한 번에 최대 1,000행만 돌려준다. 끝까지 읽어 모은다.
const PAGE = 1000;
async function selectAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const chunk = unwrap(await buildQuery().range(from, from + PAGE - 1));
    rows.push(...chunk);
    if (chunk.length < PAGE) return rows;
  }
}

export function createRepo(db) {
  const one = async (q) => (await q.maybeSingle().then(unwrap)) ?? null;

  // 식당 목록에 조사 결과(survey)와 좋아요/싫어요 수를 붙인다.
  async function withSurveyAndLikes(places) {
    const surveys = [], reactions = [];
    for (let i = 0; i < places.length; i += 500) {
      const part = places.slice(i, i + 500).map((p) => p.naver_id);
      surveys.push(...await selectAll(() => db.from('surveys').select('naver_id,status').in('naver_id', part).order('naver_id')));
      // reactions 표는 나중에 추가된 마이그레이션이라, 아직 없으면 좋아요 0 으로 보여 준다 (화면이 죽지 않게).
      try { reactions.push(...await selectAll(() => db.from('reactions').select('naver_id,kind').in('naver_id', part).order('naver_id'))); }
      catch (e) { if (!/reactions/.test(e.message)) throw e; }
    }
    const sm = new Map(surveys.map((s) => [s.naver_id, s.status]));
    const likes = new Map(), dislikes = new Map();
    for (const r of reactions) (r.kind === 'like' ? likes : dislikes).set(r.naver_id, ((r.kind === 'like' ? likes : dislikes).get(r.naver_id) ?? 0) + 1);
    return places.map((p) => ({ ...p, survey: sm.get(p.naver_id) ?? null, likes: likes.get(p.naver_id) ?? 0, dislikes: dislikes.get(p.naver_id) ?? 0 }));
  }

  return {
    async findAlias(query) {
      return one(db.from('region_aliases').select('region_id,want,categories').eq('query', query));
    },
    async findRegionByQuery(query) {
      return one(db.from('regions').select('*').eq('query', query).order('created_at', { ascending: false }).limit(1));
    },
    async createRegion({ query, name }) {
      return unwrap(await db.from('regions').insert({ query, name, status: 'collecting' }).select('*').single());
    },
    async getRegion(id) {
      return one(db.from('regions').select('*').eq('id', id));
    },
    async listRegions() {
      return unwrap(await db.from('regions').select(REGION_LIST_COLS).neq('status', 'merged').order('created_at', { ascending: false }));
    },
    async resetToCollecting(id) {
      // created_at 은 "마지막으로 수집을 요청한 때"로 쓴다. 3분 규칙의 기준.
      unwrap(await db.from('regions').update({ status: 'collecting', error: null, merged_into: null, started_at: null, suggestions: null, created_at: new Date().toISOString() }).eq('id', id));
    },
    async markStarted(id) {
      unwrap(await db.from('regions').update({ started_at: new Date().toISOString() }).eq('id', id));
    },
    async failRegion(id, error, { suggestions } = {}) {
      unwrap(await db.from('regions').update({ status: 'failed', error, suggestions: suggestions?.length ? suggestions : null }).eq('id', id));
    },
    async setRegionAi(id, fields) {
      const allowed = {};
      for (const k of ['search_query', 'ai_note', 'ai_excluded']) if (k in fields) allowed[k] = fields[k];
      unwrap(await db.from('regions').update(allowed).eq('id', id));
    },
    async markReady(id) {
      unwrap(await db.from('regions').update({ status: 'ready', error: null }).eq('id', id));
    },
    async setRegionPolygon(id, { source_kind, source_key, source_name, polygon, bbox, name }) {
      unwrap(await db.from('regions').update({ source_kind, source_key, source_name, polygon, bbox, name }).eq('id', id));
    },
    async findRegionBySourceKey(source_key) {
      return one(db.from('regions').select('*').eq('source_key', source_key).neq('status', 'merged').limit(1));
    },
    async mergeRegion(id, intoId, query, filter) {
      unwrap(await db.from('regions').update({ status: 'merged', merged_into: intoId }).eq('id', id));
      await this.upsertAlias(query, intoId, filter);
    },
    async upsertAlias(query, region_id, filter) {
      const row = { query, region_id, want: filter?.want ?? null, categories: filter?.categories ?? null };
      unwrap(await db.from('region_aliases').upsert(row, { onConflict: 'query' }));
    },
    async getRegionCategories(region_id) {
      const links = await selectAll(() => db.from('region_places').select('naver_id').eq('region_id', region_id).order('naver_id'));
      const ids = links.map((l) => l.naver_id);
      const cats = new Set();
      for (let i = 0; i < ids.length; i += 500) {
        const part = ids.slice(i, i + 500);
        for (const p of await selectAll(() => db.from('places').select('category').in('naver_id', part).order('naver_id'))) if (p.category) cats.add(p.category);
      }
      return [...cats];
    },
    async upsertPlaces(places) {
      if (!places.length) return;
      unwrap(await db.from('places').upsert(places, { onConflict: 'naver_id' }));
    },
    async linkPlaces(region_id, naver_ids) {
      if (!naver_ids.length) return;
      const rows = naver_ids.map((naver_id) => ({ region_id, naver_id }));
      unwrap(await db.from('region_places').upsert(rows, { onConflict: 'region_id,naver_id', ignoreDuplicates: true }));
    },
    async getRegionPlaces(region_id) {
      const links = await selectAll(() => db.from('region_places').select('naver_id').eq('region_id', region_id).order('naver_id'));
      const ids = links.map((l) => l.naver_id);
      if (!ids.length) return [];
      const places = [];
      for (let i = 0; i < ids.length; i += 500) {
        const part = ids.slice(i, i + 500);
        places.push(...await selectAll(() => db.from('places').select('*').in('naver_id', part).order('naver_id')));
      }
      return withSurveyAndLikes(places);
    },
    // 지도 화면 안(bbox = [minLng, minLat, maxLng, maxLat])의 식당. limit 개를 넘으면 truncated 를 켠다.
    async getPlacesInBbox([minLng, minLat, maxLng, maxLat], limit) {
      const rows = [];
      for (let from = 0; rows.length <= limit; from += PAGE) {   // PostgREST 는 한 번에 1,000행까지라 나눠 읽는다
        const chunk = unwrap(await db.from('places').select('*')
          .gte('lng', minLng).lte('lng', maxLng).gte('lat', minLat).lte('lat', maxLat)
          .order('naver_id').range(from, Math.min(from + PAGE, limit + 1) - 1));
        rows.push(...chunk);
        if (chunk.length < PAGE) break;
      }
      const truncated = rows.length > limit;
      return { places: await withSurveyAndLikes(rows.slice(0, limit)), truncated };
    },
    // 기기 하나가 식당 하나에 남기는 좋아요/싫어요. kind 가 null 이면 지운다. 바뀐 뒤의 집계를 돌려준다.
    async setReaction(naver_id, device_id, kind) {
      if (kind == null) unwrap(await db.from('reactions').delete().eq('naver_id', naver_id).eq('device_id', device_id));
      else unwrap(await db.from('reactions').upsert({ naver_id, device_id, kind, created_at: new Date().toISOString() }, { onConflict: 'naver_id,device_id' }));
      const rows = await selectAll(() => db.from('reactions').select('kind').eq('naver_id', naver_id).order('device_id'));
      return { likes: rows.filter((r) => r.kind === 'like').length, dislikes: rows.filter((r) => r.kind === 'dislike').length };
    },
    async setSurvey(naver_id, status) {
      if (status == null) unwrap(await db.from('surveys').delete().eq('naver_id', naver_id));
      else unwrap(await db.from('surveys').upsert({ naver_id, status, updated_at: new Date().toISOString() }, { onConflict: 'naver_id' }));
    },
    async deleteRegion(id) {
      unwrap(await db.from('regions').delete().eq('id', id));
    },
    async nextCollecting() {
      return one(db.from('regions').select('*').eq('status', 'collecting').order('created_at', { ascending: true }).limit(1));
    },
    async staleCollecting(minutes) {
      const before = new Date(Date.now() - minutes * 60000).toISOString();
      return unwrap(await db.from('regions').select(REGION_LIST_COLS).eq('status', 'collecting').lt('created_at', before));
    },
    async statsInput() {
      const regions = unwrap(await db.from('regions').select('id,name').eq('status', 'ready').order('created_at', { ascending: false }));
      const ids = regions.map((r) => r.id);
      const links = ids.length ? await selectAll(() => db.from('region_places').select('region_id,naver_id').in('region_id', ids).order('region_id').order('naver_id')) : [];
      const surveys = await selectAll(() => db.from('surveys').select('naver_id,status').order('naver_id'));
      return { regions, links, surveys };
    },
  };
}
