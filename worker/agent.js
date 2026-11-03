// AI 판단 층. 모델이 실패하면 항상 결정론적 기본값으로 돌아간다 (수집이 멈추지 않게).
import { askJson as defaultAskJson } from '../lib/gemini.js';

export const DEFAULT_CONTEXT = process.env.SURVEY_CONTEXT || '대구광역시에서 진행하는 비플페이(대구로페이) 가맹점 현장조사';

const S = (t) => ({ type: 'STRING', ...t });

export function createAgent({ askJson = defaultAskJson, context = DEFAULT_CONTEXT, log = () => {} } = {}) {
  const system = (role) =>
    `너는 ${context}를 돕는 보조 에이전트다. ${role} 반드시 JSON 스키마대로만 답한다. 한국어로 짧게 쓴다.`;

  return {
    async interpretQuery(raw) {
      try {
        const out = await askJson({
          system: system('조사원이 입력한 문장을 두 부분으로 나눈다. (1) query: 네이버 지도 검색창에 넣었을 때 의도한 구획(동·거리·상권)이 정확히 잡히는 지역 검색어. 조사 지역(시·구)이 빠져 있으면 붙이되, 입력된 지명이 조사 지역에 없고 다른 도시에만 있는 것이 분명하면(예: 을지로·명동은 서울) 그 도시의 시·구를 붙인다. "근처", "쪽", "먹자골목" 같은 말은 빼거나 구체 지명으로 바꾼다. 이미 충분히 구체적이면 그대로 둔다. (2) want: 조사원이 특정 업종만 원했으면 그 표현("한식집", "카페", "술집")을 그대로 쓰고, 업종 언급이 없으면 빈 문자열. note 에는 고친 이유를 한 문장으로 쓰되, 고치지 않았으면 빈 문자열로 둔다.'),
          user: `입력: ${raw}`,
          schema: { type: 'OBJECT', properties: { query: S(), note: S(), want: S() }, required: ['query', 'note', 'want'] },
        });
        const query = String(out?.query ?? '').trim().replace(/\s+/g, ' ');
        if (!query) return { query: raw, note: null, want: null };
        return { query, note: String(out?.note ?? '').trim() || null, want: String(out?.want ?? '').trim() || null };
      } catch (e) {
        log(`agent interpretQuery fallback: ${e.message}`);
        return { query: raw, note: null, want: null };
      }
    },

    // 수집된 업종 목록 중 음식·음료를 파는 매장이 아닌 것을 고른다 (미용실, 학원, 방탈출카페 …).
    async excludeNonFood(categories) {
      const cats = [...new Set((categories || []).filter(Boolean))];
      if (!cats.length) return [];
      try {
        const out = await askJson({
          system: system('네이버 지도 업종 이름 목록을 보고, 음식이나 음료를 조리·판매하는 매장(식당, 분식, 카페, 디저트, 술집, 주점, 치킨, 피자, 뷔페 등)이 아닌 업종만 골라 exclude 에 넣는다. 예: 미용실, 네일샵, 학원, 피부과, 사진관, 방탈출카페, 호텔, 꽃집, 옷가게. 애매하면 남긴다(제외하지 않는다). 목록에 있는 이름을 글자 그대로 쓴다.'),
          user: `업종 목록:\n${cats.join('\n')}`,
          schema: { type: 'OBJECT', properties: { exclude: { type: 'ARRAY', items: S() } }, required: ['exclude'] },
        });
        const set = new Set(cats);
        return [...new Set((Array.isArray(out?.exclude) ? out.exclude : []).map(String).filter((c) => set.has(c)))];
      } catch (e) {
        log(`agent excludeNonFood fallback: ${e.message}`);
        return [];
      }
    },

    // 조사원이 원한 업종 표현("한식집")에 해당하는 네이버 업종들을 고른다.
    async matchCategories(want, categories) {
      const cats = [...new Set((categories || []).filter(Boolean))];
      if (!want || !cats.length) return [];
      try {
        const out = await askJson({
          system: system('조사원이 원한 업종 표현과 네이버 지도 업종 이름 목록을 보고, 그 표현에 해당하는 업종을 모두 matched 에 넣는다. 예: "한식집" → 한식, 백반·가정식, 찌개·전골, 국밥, 고기구이 등. "카페" → 카페·디저트, 베이커리. 목록에 있는 이름을 글자 그대로 쓴다. 해당하는 것이 없으면 빈 배열.'),
          user: `원한 업종: ${want}\n업종 목록:\n${cats.join('\n')}`,
          schema: { type: 'OBJECT', properties: { matched: { type: 'ARRAY', items: S() } }, required: ['matched'] },
        });
        const set = new Set(cats);
        return [...new Set((Array.isArray(out?.matched) ? out.matched : []).map(String).filter((c) => set.has(c)))];
      } catch (e) {
        log(`agent matchCategories fallback: ${e.message}`);
        return [];
      }
    },

    async chooseCandidate(raw, candidates) {
      if (!Array.isArray(candidates) || candidates.length < 2) return { index: 0, reason: null };
      try {
        const list = candidates.map((c, i) => `${i}. ${c.name} (${c.category ?? ''}) ${c.address ?? ''}`).join('\n');
        const out = await askJson({
          system: system('네이버 지도 검색 결과 중 구획(폴리곤)이 있는 후보 목록을 보고, 조사원이 입력한 지역 이름의 의도에 가장 맞는 후보 하나의 번호(index)를 고른다. 식당이 모여 있는 거리·상권을 조사하는 목적임을 고려한다.'),
          user: `입력: ${raw}\n후보:\n${list}`,
          schema: { type: 'OBJECT', properties: { index: { type: 'INTEGER' }, reason: S() }, required: ['index', 'reason'] },
        });
        const index = Number(out?.index);
        if (!Number.isInteger(index) || index < 0 || index >= candidates.length) return { index: 0, reason: null };
        return { index, reason: String(out?.reason ?? '').trim() || null };
      } catch (e) {
        log(`agent chooseCandidate fallback: ${e.message}`);
        return { index: 0, reason: null };
      }
    },

    // 네이버에 구획이 없을 때: 공공데이터 가게들의 도로명 목록에서 검색어가 가리키는 도로를 고른다. 없으면 index null.
    async pickRoad(raw, roads) {
      const list = Array.isArray(roads) ? roads : [];
      if (!list.length) return { index: null, reason: null };
      const lastWord = String(raw || '').trim().split(/\s+/).pop();
      const exact = list.indexOf(lastWord);
      try {
        const out = await askJson({
          system: system('조사원이 입력한 검색어와, 그 근처 가게들의 도로명 목록을 본다. 검색어가 도로(…로, …길, …대로)를 가리키면 같은 도로의 번호(index)를 고른다. 옛 이름·줄임말도 인정한다(예: "중앙로" → "중앙대로"). "중앙대로81길"처럼 번호가 붙은 가지 길은 다른 도로다. 검색어가 도로가 아니면(명소, 가게 이름, 동 이름) index 를 -1 로 한다.'),
          user: `검색어: ${raw}\n도로명 목록:\n${list.map((r, i) => `${i}. ${r}`).join('\n')}`,
          schema: { type: 'OBJECT', properties: { index: { type: 'INTEGER' }, reason: S() }, required: ['index', 'reason'] },
        });
        const index = Number(out?.index);
        const reason = String(out?.reason ?? '').trim() || null;
        if (Number.isInteger(index) && index >= 0 && index < list.length) return { index, reason };
        return { index: exact >= 0 ? exact : null, reason };
      } catch (e) {
        log(`agent pickRoad fallback: ${e.message}`);
        return { index: exact >= 0 ? exact : null, reason: null };
      }
    },

    async suggestNarrower(raw, regionName) {
      try {
        const out = await askJson({
          system: system('조사원이 입력한 지역이 너무 넓어 수집에 실패했다. 그 지역 안에서 식당이 모여 있는 더 좁은 하위 지역(법정동, 거리, 상권) 이름을 네이버 지도 검색어 형태(시·구 포함)로 2~4개 제안한다. 실제로 존재하는 지명만 쓴다.'),
          user: `입력: ${raw}\n네이버가 잡은 구획: ${regionName}`,
          schema: { type: 'OBJECT', properties: { queries: { type: 'ARRAY', items: S() } }, required: ['queries'] },
        });
        return (Array.isArray(out?.queries) ? out.queries : []).map((q) => String(q).trim()).filter(Boolean).slice(0, 4);
      } catch (e) {
        log(`agent suggestNarrower fallback: ${e.message}`);
        return [];
      }
    },
  };
}
