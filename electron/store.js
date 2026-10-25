// Small JSON store in the app's userData directory.
const fs = require('node:fs');
const path = require('node:path');

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }
  file(name) {
    return path.join(this.dir, `${name}.json`);
  }
  get(name, fallback) {
    try {
      return JSON.parse(fs.readFileSync(this.file(name), 'utf8'));
    } catch {
      return fallback;
    }
  }
  set(name, value) {
    const tmp = this.file(name) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, this.file(name));
  }
}

// Environment variables pi reads for each provider's API key.
const KEY_ENV = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  opencode: 'OPENCODE_API_KEY',
  'opencode-go': 'OPENCODE_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  xai: 'XAI_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
};

// opencode and opencode-go share one env var, so map saved keys by env name:
// the first saved key wins and a stale duplicate cannot flip the value per launch.
function envForKeys(keys) {
  const env = {};
  for (const [provider, key] of Object.entries(keys)) {
    const name = KEY_ENV[provider];
    if (name && key && !env[name]) env[name] = key;
  }
  return env;
}

module.exports = { Store, KEY_ENV, envForKeys };
