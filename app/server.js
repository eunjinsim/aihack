const express = require('express');
const path = require('path');

const analyzeMenu = require('./api/analyze-menu');
const translateText = require('./api/translate-text');

const app = express();
app.use(express.json({ limit: '10mb' }));

app.post('/api/analyze-menu', analyzeMenu);
app.post('/api/translate-text', translateText);

app.use(express.static(__dirname));

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`FitBridge dev server running at http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) {
    console.warn('Warning: GEMINI_API_KEY is not set — menu analysis and allergy translation will fail. See README.md.');
  }
});
