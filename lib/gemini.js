// Google Gemini REST 호출 (SDK 없이 fetch 만). JSON 스키마로 구조화된 답을 받는다.
import 'dotenv/config';

export const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

export async function askJson(
  { system, user, schema, temperature = 0.2 },
  { apiKey = process.env.GEMINI_API_KEY, model = DEFAULT_MODEL, fetchImpl = fetch, timeoutMs = 20000 } = {},
) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is required');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature },
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`gemini ${res.status}: ${data?.error?.message ?? 'request failed'}`);
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}
