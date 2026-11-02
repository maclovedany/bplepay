// Supabase 접근은 전부 여기서만 한다. source_key 는 "kind:key" 형식.

const REGION_LIST_COLS = 'id,query,name,source_kind,source_key,source_name,bbox,status,merged_into,error,created_at';

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

export function createRepo(db) {
  const one = async (q) => (await q.maybeSingle().then(unwrap)) ?? null;

  return {
    async findAlias(query) {
      return one(db.from('region_aliases').select('region_id').eq('query', query));
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
      unwrap(await db.from('regions').update({ status: 'collecting', error: null }).eq('id', id));
    },
    async failRegion(id, error) {
      unwrap(await db.from('regions').update({ status: 'failed', error }).eq('id', id));
    },
    async markReady(id) {
      unwrap(await db.from('regions').update({ status: 'ready', error: null }).eq('id', id));
    },
    async setRegionPolygon(id, { source_kind, source_key, source_name, polygon, bbox, name }) {
      unwrap(await db.from('regions').update({ source_kind, source_key, source_name, polygon, bbox, name }).eq('id', id));
    },
    async findRegionBySourceKey(source_key) {
      return one(db.from('regions').select('*').eq('source_key', source_key).eq('status', 'ready').limit(1));
    },
    async mergeRegion(id, intoId, query) {
      unwrap(await db.from('regions').update({ status: 'merged', merged_into: intoId }).eq('id', id));
      await this.upsertAlias(query, intoId);
    },
    async upsertAlias(query, region_id) {
      unwrap(await db.from('region_aliases').upsert({ query, region_id }, { onConflict: 'query' }));
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
      const links = unwrap(await db.from('region_places').select('naver_id').eq('region_id', region_id));
      const ids = links.map((l) => l.naver_id);
      if (!ids.length) return [];
      const places = unwrap(await db.from('places').select('*').in('naver_id', ids));
      const surveys = unwrap(await db.from('surveys').select('naver_id,status').in('naver_id', ids));
      const sm = new Map(surveys.map((s) => [s.naver_id, s.status]));
      return places.map((p) => ({ ...p, survey: sm.get(p.naver_id) ?? null }));
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
      const links = ids.length ? unwrap(await db.from('region_places').select('region_id,naver_id').in('region_id', ids)) : [];
      const surveys = unwrap(await db.from('surveys').select('naver_id,status'));
      return { regions, links, surveys };
    },
  };
}
