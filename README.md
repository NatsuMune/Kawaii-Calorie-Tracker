# 卡路里大作战

A cute local-first PWA calorie intake tracker optimized for phone-sized screens.

## Features
- Dashboard with weekly graph + recent history
- Log intake with text + calories
- Settings for daily goal, haptics, and clearing data
- All data saved in `localStorage`
- Offline-ready via service worker
- Mobile-first bottom navigation, playful transitions, and tap animations

## Run locally
From this folder:

```bash
python3 -m http.server 4173 --bind 0.0.0.0
```

Then open:
- `http://localhost:4173`

## Notes
- Best on iPhone-sized screens, including large Pro/Pro Max layouts.
- Haptics use the Web Vibration API when supported.
- Data is stored only on-device in the browser.


## Live reload (recommended while iterating)

From this folder:

```bash
npx live-server --host=0.0.0.0 --port=4173 --no-browser
```

This keeps the app reachable over Tailscale and reloads automatically when files change.
