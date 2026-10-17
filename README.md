# ask-kanishk-proxy

Tiny Vercel serverless function that sits between [Ask-Kanishk](https://kanishksaini-007.github.io/Ask-Kanishk/) and the Gemini API.

## Why it exists

My first version of the chatbot had the Gemini API key in the frontend code. GitHub's secret scanning flagged the commit and Google auto-revoked the key within minutes. Lesson learned: keys don't belong in public frontend code. So now:

- Browser → this proxy (`POST /api/chat`) → Gemini API
- The key lives only in the `GEMINI_API_KEY` environment variable on Vercel
- The proxy only answers requests from my own site (`kanishksaini-007.github.io`)

## Endpoint

`POST /api/chat` with `{ "message": "...", "history": [...], "system": "..." }` → `{ "reply": "...", "model": "..." }`

`GET /api/chat` → health check.
