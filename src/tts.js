import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hash } from './cache.js';

const isQwen = (model) => model.startsWith('qwen-tts');

/**
 * Text-to-speech via an OpenAI-compatible `/audio/speech` endpoint. `synth` writes
 * `file` (wav), unless `cache` says it was already generated from the same inputs.
 *
 * - qwentts (model `qwen-tts*`): no fixed voice list. No voice = the default narrator;
 *   a voice is a text *description* ("warm, calm female narrator") that is sent as
 *   `instructions` to the voice-design model. `seed` is optional.
 * - anything else (OpenAI, Kokoro-FastAPI, ...): `voice` is a voice name, `speed` applies.
 */
export function createTts({ url, key, model, voice: defaultVoice, speed, seed, cache }) {
  const base = url.replace(/\/+$/, '');
  return async function synth(text, file, voice = defaultVoice) {
    const qwen = isQwen(model);
    const designed = qwen && voice && voice !== 'default';
    const body = qwen
      ? {
          model: designed ? 'qwen-tts-voicedesign' : 'qwen-tts',
          input: text,
          response_format: 'wav',
          ...(designed && { instructions: voice }),
          ...(seed !== undefined && { seed }),
        }
      : { model, input: text, voice, speed, response_format: 'wav' };

    const id = hash(base, body);
    if (await cache.fresh(file, id)) return file;

    const res = await fetch(`${base}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key && { Authorization: `Bearer ${key}` }) },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`TTS ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
    const audio = Buffer.from(await res.arrayBuffer());
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, audio);
    await cache.record(file, id);
    return file;
  };
}
