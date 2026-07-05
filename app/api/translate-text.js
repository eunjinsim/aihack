// Local (non-Vercel) handler for POST /api/translate-text.
//
// Translates a free-typed custom allergy word into Korean via Codex CLI
// (text-only task — no image involved, so no need for the Gemini vision step).

const path = require('path');
const { runCodex } = require('../lib/codex-cli');

const APP_ROOT = path.join(__dirname, '..');
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 10000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  const word = text.trim();
  const prompt = `Translate the following food/ingredient/allergy word into Korean. Reply with ONLY the Korean word or short phrase, nothing else — no punctuation, no explanation.\n\nWord: ${word}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const responseText = await runCodex(prompt, { cwd: APP_ROOT, timeoutMs: 60000 });
      const translated = responseText.trim().split('\n')[0].trim() || word;
      res.status(200).json({ translated });
      return;
    } catch (err) {
      if (err.transient && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      console.error('translate-text (codex) error:', err);
      res.status(200).json({ translated: word, error: 'Translation unavailable, used original text.' });
      return;
    }
  }
};
