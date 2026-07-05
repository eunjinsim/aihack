const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Runs `codex exec` headless and returns its final message text. Uses
// --output-last-message so we get exactly the model's last reply with none
// of gemini-cli's rambling/restated-answer behavior to work around.
function runCodex(prompt, { cwd, schemaPath, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const outFile = path.join(os.tmpdir(), `codex-out-${crypto.randomUUID()}.txt`);
    const args = [
      'exec', prompt,
      '--skip-git-repo-check', '--ephemeral',
      '-s', 'read-only',
      '-o', outFile
    ];
    if (schemaPath) args.push('--output-schema', schemaPath);

    execFile('codex', args, { cwd, timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      let result;
      try {
        result = fs.readFileSync(outFile, 'utf8');
      } catch {
        result = null;
      }
      fs.unlink(outFile, () => {});

      if (!result || !result.trim()) {
        const combined = `${stdout}\n${stderr}`;
        reject(Object.assign(
          new Error(`codex exec produced no output${err ? `: ${err.message}` : ''}`),
          { transient: /rate.?limit|overloaded|quota|503|429/i.test(combined) }
        ));
        return;
      }

      resolve(result.trim());
    });
  });
}

module.exports = { runCodex };
