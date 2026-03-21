# 卡路里大作战

A cute local-first PWA calorie intake tracker optimized for phone-sized screens, now with a small local AI estimation proxy for food text/photo input.

## MVP highlights
- Dashboard with weekly graph + recent history
- Manual logging with text, calories, meal type, favorites, and backfilled timestamps
- AI calorie estimation flow in the Log tab
  - input food text
  - optional food photo
  - fill result back into the form before saving
- Built-in AI providers only:
  - OpenRouter
  - z.ai
- Same-origin local proxy so browser pages do **not** need API secrets embedded in client JS
- Settings show the current AI provider, model, proxy URL, and detected source status
- Local backup import/export
- Offline-ready app shell via service worker

## AI provider env vars
Use either provider, or both:

```bash
export OPENROUTER_API_KEY=...
export ZAI_API_KEY=...
# or
export ZAI_AUTH_TOKEN=...
```

## Run locally
From this folder:

```bash
npm start
```

Then open:
- `http://127.0.0.1:4174`

The local server does two jobs:
- serves the app
- exposes the AI helper endpoints:
  - `GET /api/ai/config`
  - `POST /api/ai/estimate`

## Using AI estimate
1. Open **记录**
2. In **AI 热量估算**, type what you ate
3. Optionally attach a food photo
4. Tap **AI 估算并填入**
5. Review/fix the filled values, then save normally

If the selected provider has no local key configured, settings will tell you.

## AI settings
In **设置**, you can adjust:
- provider: `openrouter` or `z-ai`
- model name
- proxy URL

This MVP keeps the config intentionally simple. There is no browser auth, no PKCE, no Codex/OpenAI account flow, and no CLI import UI.

## Test
```bash
npm run test:e2e
```

## Notes
- Best on iPhone-sized screens, including large Pro/Pro Max layouts.
- All tracker data is stored locally in the browser.
- AI requests go through the local Node proxy and use server-side env vars.
- For image estimation, the selected model/provider must support image input on its chat-completions endpoint.
- For reliable offline use, open the app once while online so the service worker can cache the app shell, then install it to the home screen if you want a more app-like offline experience.
