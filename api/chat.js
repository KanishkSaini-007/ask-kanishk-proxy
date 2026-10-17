// ask-kanishk-proxy — tiny serverless middleman between the Ask-Kanishk
// site and the Gemini API. The API key lives ONLY in the GEMINI_API_KEY
// environment variable, never in this repo or the browser.

const MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-3.8-flash"];
const ALLOWED_ORIGIN = "https://kanishksaini-007.github.io";

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") return res.status(200).json({ ok: true, service: "ask-kanishk-proxy" });
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  if (origin && origin !== ALLOWED_ORIGIN) return res.status(403).json({ error: "forbidden origin" });

  const { message, history = [], system = "" } = req.body || {};
  if (!message || typeof message !== "string" || message.length > 600) {
    return res.status(400).json({ error: "bad message" });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "GEMINI_API_KEY not configured" });

  const contents = [...history.slice(-10), { role: "user", parts: [{ text: message }] }];
  let lastErr = null;
  for (const model of MODELS) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: system }] },
            contents,
            generationConfig: { temperature: 0.7, maxOutputTokens: 400 },
          }),
        }
      );
      if (!r.ok) { lastErr = new Error(`${model}: HTTP ${r.status}`); continue; }
      const data = await r.json();
      const reply = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("")?.trim();
      if (!reply) { lastErr = new Error(`${model}: empty reply`); continue; }
      return res.status(200).json({ reply, model });
    } catch (e) { lastErr = e; }
  }
  return res.status(502).json({ error: String(lastErr || "all models failed") });
}
