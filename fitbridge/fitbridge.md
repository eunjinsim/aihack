# Jeonpo Guide — AI Menu Translation Setup

This app uses real AI (Google's Gemini 2.5 Flash vision model) to read and
translate photos of Korean menus/dishes. To keep your API key private and
secure, it lives in a small serverless function (`api/analyze-menu.js`)
instead of the main webpage — the browser never sees the key.

Gemini was chosen because Google offers a genuinely free tier: **no credit
card required**, ever. There's a daily usage limit, but it's generous
enough for personal/small-scale use (roughly 250 requests per day on the
`gemini-2.5-flash` model at the time this was written — Google's limits do
change over time, so double-check at https://ai.google.dev/gemini-api/docs/rate-limits
if you hit unexpected errors).

**Trade-off to know about**: on the free tier, Google's terms allow your
photos and the AI's responses to be used to help improve their models. If
that matters for your use case, you can enable billing on the same API key
later to opt out of that — see Google's docs for details.

## One-time setup (do this once)

### 1. Get a free Gemini API key
1. Go to https://aistudio.google.com/apikey
2. Sign in with a Google account (any personal Gmail account works)
3. Click **"Create API Key"** — choose or create a Google Cloud project when prompted (this is just a free container, not a billing account)
4. Copy the key — you can view it again later if needed, but keep it safe

### 2. Deploy this folder to Vercel
1. Go to https://vercel.com/drop
2. Drag this **entire folder** (or the zip file) onto the page
   - Important: make sure `index.html` and the `api` folder both end up at
     the top level of the project — not nested inside another folder.
3. Wait for it to deploy — you'll get a link like `https://your-project.vercel.app`

### 3. Add your API key to Vercel (required — the app won't work without this)
1. In your Vercel dashboard, open this project
2. Go to **Settings > Environment Variables**
3. Add a new variable:
   - **Name:** `GEMINI_API_KEY`
   - **Value:** the key you copied in step 1
4. Go to the **Deployments** tab, find the latest deployment, click the **⋯**
   menu, and choose **Redeploy** so the new variable takes effect

### 4. Test it
Open your `https://your-project.vercel.app` link on your phone, go to the
"Menu Translation" tab, take or upload a photo of Korean food, and press
the scan button. It should return a real translation, ingredients, spice
level, and allergy check based on the actual photo.

## Cost

Free, as long as you stay within Google's daily free-tier limits. No card
is ever charged unless you deliberately enable billing on the project.

## If something goes wrong

- **"AI 분석에 실패했습니다" toast appears every time** → Check that
  `GEMINI_API_KEY` (not `OPENAI_API_KEY` — the name matters) is set
  correctly in Vercel's Environment Variables for *this specific project*,
  and that you redeployed after adding it. Every new Vercel Drop upload
  creates a brand-new project, so environment variables must be re-added
  each time you deploy a fresh copy.
- **413 / "Payload Too Large" errors** → Already handled: photos are
  automatically resized in the browser before upload. If you still see
  this, the photo may be an unusual format — try a standard JPEG/PNG photo.
- **429 errors** → You've hit Google's free daily/per-minute limit. Wait a
  bit (limits reset daily) or check your usage at https://aistudio.google.com
- **Still failing** → Check the Vercel project's **Logs** tab right after
  triggering a scan — it will show the exact error message from Google's
  API, which is the fastest way to diagnose the specific problem.
