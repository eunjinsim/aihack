// Local (non-Vercel) handler for POST /api/analyze-menu.
//
// Two-stage pipeline:
//   1. Gemini REST API (direct HTTP call, not gemini-cli) does the vision
//      work — reads the photo and extracts raw facts in English. A single
//      REST call uses a small fraction of the tokens/quota gemini-cli's
//      agent loop would burn for the same photo.
//   2. Codex CLI (`codex exec`, text-only, no image) takes those raw facts
//      and produces the final translated, schema-validated dish list in the
//      user's UI language.

const fs = require('fs');
const path = require('path');
const { extractJson } = require('../lib/extract-json');
const { callGeminiVision } = require('../lib/gemini-rest');
const { runCodex } = require('../lib/codex-cli');

const LANGUAGE_NAMES = {
  en: 'English', ja: 'Japanese', zh: 'Chinese (Simplified)',
  vi: 'Vietnamese', es: 'Spanish', ko: 'Korean'
};

const ALLERGEN_IDS = [
  'peanut', 'walnut', 'pinenut', 'wheat', 'buckwheat', 'egg', 'milk',
  'shrimp', 'crab', 'squid', 'mackerel', 'shellfish', 'soybean',
  'pork', 'beef', 'chicken', 'peach', 'tomato', 'sulfites'
];

const APP_ROOT = path.join(__dirname, '..');
const SCHEMA_PATH = path.join(__dirname, '..', 'lib', 'dish-schema.json');
const MAX_CODEX_RETRIES = 2;
const CODEX_RETRY_DELAY_MS = 10000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildCodexPrompt(rawFacts, targetLanguage) {
  const languageName = LANGUAGE_NAMES[targetLanguage] || 'English';
  return `You are given raw, English-only facts a vision model extracted from a photo of Korean food. Turn them into the final localized dish list for a travel app.

Raw facts (JSON):
${JSON.stringify(rawFacts)}

For each dish, produce an object with:
- name_ko: copy as-is
- name_en: copy as-is
- translated_name: the dish name translated into ${languageName}
- ingredients: the ingredients translated/rewritten into ${languageName}, comma-separated
- allergens: refine "visible_allergen_hints" into a subset of ONLY these ids (lowercase): ${ALLERGEN_IDS.join(', ')}
- crossContactAllergens: any of the same ids that are only a trace/cross-contact risk (optional, can be empty array)
- spicy: copy "spicy_guess" as an integer 0-3
- eatingMethod: 2-3 short practical steps for how to eat this dish, written in ${languageName}
- description: 1-2 sentence description, written in ${languageName}

Respond with ONLY the final JSON object (matching the required output schema), nothing else.`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is missing GEMINI_API_KEY. Add it to app/.env and restart the server.' });
    return;
  }

  const { imageBase64, targetLanguage } = req.body || {};
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    res.status(400).json({ error: 'imageBase64 (a data: URL string) is required' });
    return;
  }

  const match = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    res.status(400).json({ error: 'imageBase64 must be a data:image/...;base64,... URL' });
    return;
  }
  const [, mimeType, base64Data] = match;
  const lang = LANGUAGE_NAMES[targetLanguage] ? targetLanguage : 'en';

  let rawFacts;
  try {
    rawFacts = await callGeminiVision(apiKey, mimeType, base64Data);
    if (!rawFacts || !Array.isArray(rawFacts.dishes)) {
      throw new Error('Unexpected response shape from Gemini vision step');
    }
  } catch (err) {
    console.error('analyze-menu (gemini vision step) error:', err);
    if (err.transient) {
      res.status(503).json({ error: 'Gemini is busy right now. Please wait a moment and try again.' });
    } else {
      res.status(500).json({ error: 'Could not analyze the photo. Please try a different photo.' });
    }
    return;
  }

  const prompt = buildCodexPrompt(rawFacts, lang);

  let lastErr;
  for (let attempt = 1; attempt <= MAX_CODEX_RETRIES; attempt++) {
    try {
      const responseText = await runCodex(prompt, { cwd: APP_ROOT, schemaPath: SCHEMA_PATH });
      const parsed = extractJson(responseText);
      if (!parsed || !Array.isArray(parsed.dishes)) {
        throw new Error('Unexpected response shape from Codex');
      }
      res.status(200).json(parsed);
      return;
    } catch (err) {
      lastErr = err;
      if (err.transient && attempt < MAX_CODEX_RETRIES) {
        await sleep(CODEX_RETRY_DELAY_MS * attempt);
        continue;
      }
      console.error('analyze-menu (codex translate/structure step) error:', err);
      if (lastErr.transient) {
        res.status(503).json({ error: 'Codex is busy right now. Please wait a moment and try again.' });
      } else {
        res.status(500).json({ error: 'Could not translate/structure the dish list. Please try again.' });
      }
      return;
    }
  }
};
