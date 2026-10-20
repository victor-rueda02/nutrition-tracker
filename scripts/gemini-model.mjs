// El modelo de Gemini sale de UN sitio: GEMINI_MODEL de worker/wrangler.toml (o la variable de entorno, si la pones);
// el de respaldo, de GEMINI_MODEL_FALLBACK (mismo sitio).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const toml = (root) => readFileSync(resolve(root, 'worker', 'wrangler.toml'), 'utf8');

export function geminiModel(root) {
  return process.env.GEMINI_MODEL || toml(root).match(/^\s*GEMINI_MODEL\s*=\s*"([^"]+)"/m)?.[1] || null;
}

export function geminiModelFallback(root) {
  return process.env.GEMINI_MODEL_FALLBACK || toml(root).match(/^\s*GEMINI_MODEL_FALLBACK\s*=\s*"([^"]+)"/m)?.[1] || null;
}
