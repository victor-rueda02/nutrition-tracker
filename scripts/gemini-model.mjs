// El modelo de Gemini sale de UN sitio: GEMINI_MODEL de worker/wrangler.toml (o la variable de entorno, si la pones).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function geminiModel(root) {
  const toml = readFileSync(resolve(root, 'worker', 'wrangler.toml'), 'utf8');
  return process.env.GEMINI_MODEL || toml.match(/^\s*GEMINI_MODEL\s*=\s*"([^"]+)"/m)?.[1] || null;
}
