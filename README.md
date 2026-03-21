# 卡路里大作战

A cute local-first PWA calorie intake tracker optimized for phone-sized screens, with a simplified text-only AI estimation flow.

## MVP highlights
- Dashboard with weekly graph + recent history
- Manual logging with text, calories, meal type, favorites, and backfilled timestamps
- Text-only AI calorie estimation flow in the Log tab
  - type what you ate
  - send the request directly from the browser to OpenRouter
  - fill the result back into the intake form before saving
- Built-in AI provider:
  - OpenRouter
- OpenRouter model and API key are configured in the front-end UI and stored locally in the browser on that device
- No local AI proxy: the Node server only serves static files for the PWA
- Tailscale serve is fine for remote page access, but it is not part of the AI request path
- Local backup import/export
- Offline-ready app shell via service worker

## Run locally
From this folder:

```bash
npm start
```

Then open:
- `http://127.0.0.1:4174`

The local server now does one job only:
- serves the app shell and static assets

## Using AI estimate
1. Open **设置**
2. Paste your OpenRouter API key into the browser UI
3. Optionally adjust the model
4. Open **记录**
5. Type what you ate in **AI 热量估算**
6. Tap **AI 估算并填入**
7. Review/fix the filled values, then save normally

## Important behavior / limitations
- This iteration is **text-only**. Image upload / vision estimation was intentionally removed.
- API keys stay in the current browser's local storage / IndexedDB fallback. They are not sent back to the local Node service for proxying.
- Direct browser access means provider behavior can vary by account, region, model, plan entitlement, and CORS policy.
- If a provider rejects browser-side cross-origin requests, the app surfaces that failure directly instead of silently rerouting through a local proxy.

## CORS notes checked during implementation
- `https://openrouter.ai/api/v1/chat/completions` responded to an `OPTIONS` preflight with browser-oriented CORS headers, including `access-control-allow-origin: *`.
- OpenRouter responded to browser-oriented preflight headers during implementation. Actual requests can still fail later because of API key validity, account permissions, model support, or transient provider issues.

## Test
```bash
npm run test:e2e
```

## Notes
- Best on iPhone-sized screens, including large Pro/Pro Max layouts.
- All tracker data and AI settings are stored locally in the browser.
- For reliable offline use, open the app once while online so the service worker can cache the app shell, then install it to the home screen if you want a more app-like offline experience.
