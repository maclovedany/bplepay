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
          system: system('조사원이 입력한 지역 이름을 네이버 지도 검색창에 넣었을 때 의도한 구획(동·거리·상권)이 정확히 잡히도록 검색어를 고친다. 조사 지역(시·구)이 빠져 있으면 붙이고, "근처", "쪽", "먹자골목" 같은 말은 빼거나 구체 지명으로 바꾼다. 이미 충분히 구체적이면 그대로 둔다. note 에는 고친 이유를 한 문장으로 쓰되, 고치지 않았으면 빈 문자열로 둔다.'),
          user: `입력: ${raw}`,
          schema: { type: 'OBJECT', properties: { query: S(), note: S() }, required: ['query', 'note'] },
        });
        const query = String(out?.query ?? '').trim().replace(/\s+/g, ' ');
        if (!query) return { query: raw, note: null };
        return { query, note: String(out?.note ?? '').trim() || null };
      } catch (e) {
        log(`agent interpretQuery fallback: ${e.message}`);
        return { query: raw, note: null };
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
