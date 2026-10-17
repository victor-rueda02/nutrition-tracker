// ÚNICO sitio que habla con el proveedor de IA. Para cambiar de proveedor, sustituye esta función
// (misma firma: recibe system/user/schema y devuelve el texto JSON del modelo).
export class ProviderError extends Error {
  constructor(status, detail) {
    super(`proveedor ${status}: ${detail}`);
    this.status = status;
  }
}

export async function callGemini({ apiKey, model, system, user, schema, fetchImpl = fetch }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema },
    }),
  });
  if (!res.ok) throw new ProviderError(res.status, (await res.text().catch(() => '')).slice(0, 200));
  const data = await res.json();
  const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  if (!text) throw new ProviderError(502, 'respuesta vacía del modelo');
  return text;
}
