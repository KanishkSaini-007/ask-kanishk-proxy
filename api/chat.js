// ask-kanishk-proxy — tiny serverless middleman between the Ask-Kanishk
// site and the Gemini API. The API key lives ONLY in the GEMINI_API_KEY
// environment variable, never in this repo or the browser.
//
// v1.5: model chain verified against the free key on 2026-10-18.
// Pro models (gemini-3.1-pro-preview, gemini-pro-latest, gemini-4-argon)
// return "free tier limit: 0" on this key, so the strongest model that
// actually runs free is gemini-3.8-flash, with older flashes as fallback.

const MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-flash-latest", "gemini-flash-lite-latest"];
const ALLOWED_ORIGIN = "https://kanishksaini-007.github.io";

// request shaping: keep payloads small so one visitor can't burn the quota
const MAX_MESSAGE_CHARS = 600;
const MAX_HISTORY_ENTRIES = 12;
const MAX_HISTORY_PART_CHARS = 1000;
const MAX_HISTORY_TOTAL_CHARS = 8000;

// best-effort rate limiting. serverless instances are ephemeral, so this
// in-memory limiter only guards a warm instance — it slows a spammer down
// but is not a hard guarantee.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 15; // requests per window per ip
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) { hits.set(ip, arr); return true; }
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear(); // don't grow forever
  return false;
}

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  const out = [];
  let total = 0;
  for (const turn of history.slice(-MAX_HISTORY_ENTRIES)) {
    if (!turn || (turn.role !== "user" && turn.role !== "model")) continue;
    const parts = Array.isArray(turn.parts) ? turn.parts : [];
    const text = parts
      .map((p) => (p && typeof p.text === "string" ? p.text : ""))
      .join("")
      .slice(0, MAX_HISTORY_PART_CHARS);
    if (!text) continue;
    total += text.length;
    if (total > MAX_HISTORY_TOTAL_CHARS) break;
    out.push({ role: turn.role, parts: [{ text }] });
  }
  return out;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") return res.status(200).json({ ok: !!process.env.GEMINI_API_KEY, service: "ask-kanishk-proxy" });
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  if (origin && origin !== ALLOWED_ORIGIN) return res.status(403).json({ error: "forbidden origin" });

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  if (rateLimited(ip)) return res.status(429).json({ error: "slow down a little" });

  const { message, history = [], system = "" } = req.body || {};
  if (!message || typeof message !== "string" || message.length > MAX_MESSAGE_CHARS) {
    return res.status(400).json({ error: "bad message" });
  }
  const safeSystem = typeof system === "string" ? system.slice(0, 12000) : "";

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "GEMINI_API_KEY not configured" });

  const contents = [...cleanHistory(history), { role: "user", parts: [{ text: message }] }];
  let lastErr = null;
  for (const model of MODELS) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: safeSystem }] },
            contents,
            generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
          }),
        }
      );
      if (!r.ok) { lastErr = new Error(`${model}: HTTP ${r.status}`); continue; }
      const data = await r.json();
      const reply = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("")?.trim();
      if (!reply) { lastErr = new Error(`${model}: empty reply`); continue; }
      return res.status(200).json({ reply, model });
    } catch (e) { lastErr = e; }
  }
  return res.status(502).json({ error: String(lastErr || "all models failed") });
}
