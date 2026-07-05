# FitBridge — 전포 가이드 서비스

A mobile-first travel companion for foreign travelers exploring the Jeonpo
cafe/restaurant street in Busan, Korea: AI menu translation with allergy/spice
warnings, a Korean allergy-communication card, a Jeonpo location map, and a
currency exchange calculator. Single-file frontend (`index.html`, no build
step) + a small local Express server that shells out to the **Gemini CLI**
for AI menu analysis. Runs entirely on your own machine — no Vercel, no
hosted backend.

## File structure

```
app/
├── index.html            # entire frontend app (single file)
├── server.js             # local Express server (static files + API routes)
├── api/
│   ├── analyze-menu.js   # calls `gemini` CLI to analyze/translate menu photos
│   └── translate-text.js # calls `gemini` CLI to translate a custom allergy word to Korean
├── lib/
│   ├── gemini-cli.js     # spawns the gemini CLI in headless (-p -o json) mode
│   └── extract-json.js   # pulls the final JSON object out of gemini's response text
├── tmp-uploads/           # gitignored — temp photo files, deleted after each request
├── package.json
├── .env                   # gitignored — holds GEMINI_API_KEY
└── README.md
```

## One-time setup

### 1. Install and authenticate the Gemini CLI
```bash
npm install -g @google/gemini-cli
```

**Auth: use an API key, not "Login with Google".** Google's personal-account
OAuth login for Gemini CLI (`oauth-personal` tier, "Gemini Code Assist for
individuals") has been discontinued — it now fails with
`IneligibleTierError: This client is no longer supported for Gemini Code
Assist for individuals`. Use an API key instead:

1. Get a free key at https://aistudio.google.com/apikey (sign in with any
   Google account, click **"Create API Key"** — no credit card needed)
2. Set `~/.gemini/settings.json` to use the API key auth type:
   ```json
   {
     "security": { "auth": { "selectedType": "gemini-api-key" } }
   }
   ```
3. Put the key in `app/.env` (create this file, it's gitignored):
   ```
   GEMINI_API_KEY=your-key-here
   ```

### 2. Install dependencies and run
```bash
cd app
npm install
npm start
```
Open http://localhost:8000.

### 3. (Optional) Get a Google Maps JavaScript API key
The Map tab works without this — it shows a "Map not set up yet" message
instead of the interactive map. To enable it, open `index.html`, find the
`CONFIG` object near the top of the `<script>` block, and set:
```js
const CONFIG = {
  GOOGLE_MAPS_API_KEY: 'your-key-here',
  GOOGLE_MAPS_MAP_ID: 'your-map-id-here'
};
```

## How the Gemini CLI integration works

`api/analyze-menu.js` writes the uploaded photo to `app/tmp-uploads/`, then
runs `gemini -p "<prompt referencing that file>" -o json` as a child process
(`lib/gemini-cli.js`). Gemini CLI is a full coding-agent CLI, not a thin API
wrapper, so a few things about it are worth knowing:

- **It reads the image itself** via its own `read_file` tool — confirmed
  working by asking it to describe a test image's exact colors.
- **The temp folder must NOT start with a dot.** Gemini CLI's default ignore
  patterns silently block dot-prefixed paths (its `read_file` tool refuses
  them with "ignored by configured ignore patterns"), so photos must live
  somewhere like `tmp-uploads/`, not `.tmp/` or `.gemini-tmp/`.
- **It rambles.** Even when told "reply with ONLY the JSON object", it often
  narrates its reasoning first and restates the final answer at the end.
  `lib/extract-json.js` handles this by scanning for every balanced `{...}`
  block in the response and using the last one that parses.
- **It's much slower and more quota-hungry than calling the Gemini API
  directly.** A single `-p` call actually triggers multiple internal model
  calls (a "utility router" pass plus the main response, sometimes
  sub-agent calls too), so one menu scan can use 10,000+ tokens and take
  15-30+ seconds — versus one direct API call. On the free tier this means
  you can hit per-minute *and* per-day quota limits much faster than the
  request count would suggest.

## Cost / quota

Free, but budget for it being tight: free-tier Gemini API quotas are shared
per API key across both per-minute and per-day limits, and gemini-cli's
agentic overhead burns through them faster than a raw API call would.
`analyze-menu.js` retries a few times with ~15-45s backoff on quota/rate
errors, but a **daily** quota exhaustion (`TerminalQuotaError: You have
exhausted your daily quota on this model`) won't resolve until the next day
— get a fresh API key if you need to keep testing.

## If something goes wrong

- **`IneligibleTierError` on `gemini` login** → See "Auth: use an API key" above.
- **"Path ... is ignored by configured ignore patterns"** → Some other tool/
  script wrote temp files to a dot-prefixed folder; they must go in
  `tmp-uploads/` (already how `analyze-menu.js` is set up).
- **Analysis fails with a quota/rate message** → Check the terminal running
  `npm start` for the actual Gemini error. Per-minute limits clear within
  ~a minute; a "daily quota" error needs a new day or a different API key.
- **Map shows "Map not set up yet"** → Expected until you add
  `GOOGLE_MAPS_API_KEY` / `GOOGLE_MAPS_MAP_ID` in `index.html`'s `CONFIG` object.
- **413 / photo too large** → Photos are resized client-side before upload
  (max 1024px, JPEG ~0.75 quality). If you still see this, try a different
  browser — in-app browsers (KakaoTalk, Instagram) sometimes fail to run
  Canvas/File APIs correctly.
- **Still failing** → Check the terminal running `npm start` — it prints the
  exact error from the `gemini` CLI for every failed request.
