// Gemini CLI is an agentic coding assistant, not a raw completion API — even
// when asked for "ONLY JSON", it tends to think out loud and often restates
// the final answer at the very end of its response. This scans for every
// top-level balanced {...} block and returns the LAST one that parses,
// since that's consistently where the model's final answer lands.
function extractJson(text) {
  const candidates = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) {
          candidates.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }

  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(candidates[i]);
    } catch {
      // try the next-earliest candidate
    }
  }

  throw new Error('No valid JSON object found in model response');
}

module.exports = { extractJson };
