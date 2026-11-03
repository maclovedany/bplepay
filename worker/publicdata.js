// 공공데이터포털 — 소상공인시장진흥공단 상가(상권)정보 API. 네이버에 구획이 없을 때 대신 쓴다.
// 반경 안 음식점(업종 대분류 I2)을 받아 places 모양으로 바꾼다. 키는 .env 의 DATA_GO_KR_KEY 에만 둔다.
export const BASE_URL = 'https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRadius';

// '대구광역시 중구 중앙대로81길' → '중앙대로81길'
export function shortRoad(rdnm) {
  const parts = String(rdnm || '').trim().split(/\s+/);
  return parts.length ? parts[parts.length - 1] : '';
}

export function normalizeStore(raw) {
  return {
    naver_id: String(raw.bizesId),                        // 상가업소번호. 열 이름은 바꾸지 않는다.
    name: [raw.bizesNm, raw.brchNm].filter(Boolean).join(' ').trim(),
    category: raw.indsSclsNm || raw.indsMclsNm || null,
    road_address: raw.rdnmAdr || null,
    address: raw.lnoAdr || null,
    phone: null,
    lng: Number(raw.lon),
    lat: Number(raw.lat),
    road: shortRoad(raw.rdnm),
    road_code: raw.rdnmCd ? String(raw.rdnmCd) : null,
  };
}

export async function fetchFoodStores({ cx, cy, radius = 1000 }, { key = process.env.DATA_GO_KR_KEY, fetchImpl = fetch, pageSize = 1000, maxPages = 5 } = {}) {
  if (!key) throw new Error('DATA_GO_KR_KEY 가 없습니다');
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const u = new URL(BASE_URL);
    u.search = new URLSearchParams({ serviceKey: key, radius: String(radius), cx: String(cx), cy: String(cy), indsLclsCd: 'I2', type: 'json', numOfRows: String(pageSize), pageNo: String(page) }).toString();
    const res = await fetchImpl(u.toString());
    const json = await res.json();
    const code = json?.header?.resultCode;
    if (code !== '00') throw new Error(`상가정보 API 오류 ${code ?? res.status}: ${json?.header?.resultMsg ?? ''}`);
    const items = json.body?.items ?? [];
    for (const it of items) out.push(normalizeStore(it));
    const total = Number(json.body?.totalCount ?? 0);
    if (items.length < pageSize || out.length >= total) break;
  }
  return out;
}

export function createPublicData({ key = process.env.DATA_GO_KR_KEY, fetchImpl = fetch } = {}) {
  return {
    enabled: Boolean(key),
    fetchFoodStores: (q) => fetchFoodStores(q, { key, fetchImpl }),
  };
}
