// Direct call to the Gemini REST API (NOT the gemini-cli) — used only for
// the vision step. A raw HTTP call uses a small fraction of the tokens/quota
// that gemini-cli's agent loop burns for the same photo, since there's no
// router pass or sub-agent overhead.

const GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 15000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const VISION_PROMPT = `Look at this photo taken by a foreign traveler at a Korean restaurant, cafe, or grocery store.

The photo may show ONE of these three things:
(a) A menu board or printed menu listing several dishes/drinks
(b) A single plated dish or drink
(c) A packaged product's ingredient/nutrition label

Handle each case differently:
- (a) List every distinct food/drink item you can find, up to 10 items.
- (b) List just that one dish.
- (c) Treat the whole label as ONE product and read its printed ingredients directly.

Ignore non-food text: store names/logos, addresses, phone numbers, prices,
section headers, barcodes, nutrition-fact numbers.

Respond with STRICT JSON ONLY, no markdown fences, no commentary:
{
  "dishes": [
    {
      "name_ko": "Korean name in Hangul",
      "name_en": "Romanized/English name",
      "ingredients_en": "comma-separated list of visible/likely ingredients, in English",
      "visible_allergen_hints": ["your best-guess subset of: peanut, walnut, pinenut, wheat, buckwheat, egg, milk, shrimp, crab, squid, mackerel, shellfish, soybean, pork, beef, chicken, peach, tomato, sulfites"],
      "spicy_guess": 0
    }
  ]
}
"spicy_guess" is an integer 0-3 (0 = not spicy, 3 = extremely spicy).`;

async function callGeminiVision(apiKey, mimeType, base64Data) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: VISION_PROMPT }, { inline_data: { mime_type: mimeType, data: base64Data } }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
  };

  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let response;
    try {
      response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (networkErr) {
      lastErr = networkErr;
      await sleep(RETRY_BASE_DELAY_MS * attempt);
      continue;
    }

    if (response.status === 429 || response.status === 503) {
      lastErr = new Error(`Gemini API busy (${response.status})`);
      await sleep(RETRY_BASE_DELAY_MS * attempt);
      continue;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw Object.assign(new Error(`Gemini API error ${response.status}: ${text}`), { status: response.status });
    }

    const json = await response.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned an empty response');
    return JSON.parse(text);
  }

  throw Object.assign(lastErr || new Error('Gemini API busy'), { transient: true });
}

module.exports = { callGeminiVision };
