// Vercel Serverless Function: /api/analyze-menu
//
// Receives a base64 photo from the browser, sends it to Google's Gemini
// vision model (server-side, where the API key stays hidden), and returns a
// structured JSON description of the dish: translated name, ingredients,
// allergens, spice level, dietary flags, and a short eating guide.
//
// SETUP REQUIRED:
// 1. Get a free API key at https://aistudio.google.com/apikey
//    (No credit card needed — sign in with a Google account, click
//    "Create API Key", done in about a minute.)
// 2. In your Vercel project settings > Environment Variables, add:
//      Name:  GEMINI_API_KEY
//      Value: <your key>
// 3. Redeploy. The key never appears in the browser or in this file.
//
// Note: Google's free tier may use free-tier requests/responses to improve
// their models. If that matters for your use case, review Gemini's terms
// or switch to a paid tier / different provider.

const ALLOWED_ALLERGEN_IDS = [
  'peanut', 'walnut', 'pineneut', 'wheat', 'buckwheat', 'egg', 'milk',
  'shrimp', 'crab', 'squid', 'mackerel', 'shellfish', 'soybean',
  'pork', 'beef', 'chicken', 'peach', 'tomato', 'sulfites'
];

const LANGUAGE_NAMES = {
  en: 'English',
  ja: 'Japanese',
  zh: 'Chinese (Simplified)',
  vi: 'Vietnamese',
  es: 'Spanish',
  ko: 'Korean'
};

const GEMINI_MODEL = 'gemini-2.5-flash';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { imageBase64, targetLanguage } = req.body || {};

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    res.status(400).json({ error: 'imageBase64 (a data: URL string) is required' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is missing GEMINI_API_KEY. Add it in Vercel > Project Settings > Environment Variables, then redeploy.' });
    return;
  }

  // Strip the "data:image/jpeg;base64," prefix — Gemini wants the raw
  // base64 payload plus a separate mime type field.
  const match = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    res.status(400).json({ error: 'imageBase64 must be a data: URL (e.g. "data:image/jpeg;base64,...")' });
    return;
  }
  const mimeType = match[1];
  const base64Data = match[2];

  const targetLangName = LANGUAGE_NAMES[targetLanguage] || 'English';

  const promptText = `You are a menu-reading assistant helping foreign travelers understand Korean food. You will be shown one of these kinds of photos:
(a) a restaurant menu board or printed menu listing several dishes,
(b) a single plated dish on a table,
(c) a packaged food product's ingredient/nutrition label (성분표).

Identify what food item(s) are actually present, based on which of these it is:
- If it's a menu board/printed menu (a): identify EVERY distinct food or drink item that has a clearly readable name — return all of them, not just one.
- If it's a single plated dish (b): return just that one dish.
- If it's a packaged product's ingredient label (c): treat the WHOLE label as describing ONE product. Read its actual printed ingredient list and allergen notices directly from the label text, and return exactly one dish entry for that product (its name, and its ingredients drawn from what's printed on the label) — do NOT split the individual listed ingredients into separate "dishes".

Do NOT treat these as food items at all: restaurant/store names or logos, addresses, phone numbers, prices shown alone, section headers (e.g. "Set Menu", "Side Dishes"), barcodes, nutrition facts numbers (calories/sodium/etc. by themselves), or any other non-food text. Only include actual food/drink/product names.

Respond with ONLY strict JSON (no markdown fences, no commentary) matching exactly this shape:
{
  "dishes": [
    {
      "name_ko": "Korean name in Hangul, e.g. 삼겹살",
      "name_en": "Romanized or English name, e.g. Samgyeopsal",
      "translated_name": "Dish name translated into ${targetLangName}",
      "ingredients": "Comma-separated key ingredients, written in ${targetLangName}",
      "allergens": ["zero or more ids from this exact list: ${ALLOWED_ALLERGEN_IDS.join(', ')}"],
      "crossContactAllergens": ["optional ids from the same list, for trace/shared-sauce risk only"],
      "spicy": 0,
      "eatingMethod": ["2 to 3 short steps for how to eat this dish, written in ${targetLangName}"],
      "description": "1-2 short sentences describing what this dish/product is, written in ${targetLangName}"
    }
  ]
}

Rules:
- Return between 1 and 10 dish entries — as many distinct food/drink items as you can clearly read, but never invent items that aren't actually visible in the photo.
- "spicy" must be an integer from 0 to 3 (0 = none, 1 = mild, 2 = hot, 3 = extreme).
- Only use allergen ids from the exact list given — never invent new ones.
- If you genuinely cannot identify any food item at all, return {"dishes": []}.
- Never return anything other than that JSON object shape.

Now analyze the attached photo and return the JSON described above.`;

  const requestBody = JSON.stringify({
    contents: [
      {
        parts: [
          { text: promptText },
          { inline_data: { mime_type: mimeType, data: base64Data } }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: 3072
    }
  });

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  // Google's free tier occasionally returns transient 429/503 errors under
  // load. These usually clear up within a second or two, so retry a couple
  // of times with a short backoff before giving up.
  const MAX_ATTEMPTS = 3;
  let lastErrorText = '';
  let lastStatus = 0;

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody
      });

      if (response.ok) {
        const data = await response.json();
        const content =
          data.candidates &&
          data.candidates[0] &&
          data.candidates[0].content &&
          data.candidates[0].content.parts &&
          data.candidates[0].content.parts[0] &&
          data.candidates[0].content.parts[0].text;

        if (!content) {
          console.error('Unexpected Gemini response shape:', JSON.stringify(data));
          res.status(502).json({ error: 'No content returned from the AI provider.' });
          return;
        }

        let parsed;
        try {
          parsed = JSON.parse(content);
        } catch (parseErr) {
          console.error('Failed to parse AI JSON response:', content);
          res.status(502).json({ error: 'The AI response was not valid JSON.' });
          return;
        }

        res.status(200).json(parsed);
        return;
      }

      lastStatus = response.status;
      lastErrorText = await response.text();
      console.error(`Gemini API error (attempt ${attempt}/${MAX_ATTEMPTS}):`, response.status, lastErrorText);

      // Only retry on errors known to be transient/load-related.
      const isRetryable = response.status === 429 || response.status === 503;
      if (!isRetryable || attempt === MAX_ATTEMPTS) {
        break;
      }
      await new Promise(r => setTimeout(r, attempt * 800));
    }

    const friendlyMessage = (lastStatus === 429 || lastStatus === 503)
      ? 'The AI is currently busy handling other requests. Please wait a moment and try again.'
      : 'The AI provider request failed. Check your API key.';
    res.status(502).json({ error: friendlyMessage });
  } catch (err) {
    console.error('analyze-menu handler error:', err);
    res.status(500).json({ error: 'Internal server error while analyzing the photo.' });
  }
}
