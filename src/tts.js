import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hash } from './cache.js';
import { findVoice, listVoices } from './voices.js';

const isQwen = (model) => model.startsWith('qwen-tts');

/**
 * Text-to-speech via an OpenAI-compatible `/audio/speech` endpoint; `url` is the audio base,
 * e.g. http://127.0.0.1:8010/v1/audio. `synth` writes `file` (wav), unless `cache` says it was
 * already generated from the same inputs.
 *
 * - qwentts (model `qwen-tts*`), `voice` is one of:
 *     none / "default"  the default narrator
 *     a sample name     a voice cloned from `voices/<name>.wav` (kept the same on every slide)
 *     a description     a voice designed from the text ("warm, calm female narrator"); drifts per slide
 *   Clones are registered with the engine on first use (and again if the engine forgot them).
 * - anything else (OpenAI, Kokoro-FastAPI, ...): `voice` is a voice name, `speed` applies.
 */
export function createTts({ url, key, model, voice: defaultVoice, speed, cache, voiceDirs = [] }) {
  const base = url.replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', ...(key && { Authorization: `Bearer ${key}` }) };
  const registered = new Set();
  const post = (body) => fetch(`${base}/speech`, { method: 'POST', headers, body: JSON.stringify(body) });

  async function register(v) {
    const res = await fetch(`${base}/voices`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: v.regName, wav_b64: v.wav.toString('base64'), ...(v.text && { ref_text: v.text }) }),
    });
    if (!res.ok) throw new Error(`registering voice "${v.name}": ${res.status} ${(await res.text()).slice(0, 300)}`);
    registered.add(v.regName);
  }

  /** the voice directive -> how to ask for it */
  async function resolve(voice) {
    if (!voice || voice === 'default') return { kind: 'default' };
    const sample = await findVoice(voice, voiceDirs);
    if (sample) {
      const id = hash(sample.wav, sample.text ?? '');
      return { kind: 'clone', ...sample, id, regName: `deck_${voice.replace(/\W/g, '_')}_${id.slice(0, 8)}` };
    }
    if (/^[\w.-]+$/.test(voice)) {
      const known = await listVoices(voiceDirs);
      throw new Error(`unknown voice "${voice}" (samples: ${known.join(', ') || 'none'}; or give a description with spaces)`);
    }
    return { kind: 'design' };
  }

  return async function synth(text, file, voice = defaultVoice) {
    if (!isQwen(model)) {
      const body = { model, input: text, voice, speed, response_format: 'wav' };
      return generate(body, hash(base, body), file);
    }
    const v = await resolve(voice);
    const body = {
      model: v.kind === 'design' ? 'qwen-tts-voicedesign' : 'qwen-tts',
      input: text,
      response_format: 'wav',
      ...(v.kind === 'design' && { instructions: voice }),
      ...(v.kind === 'clone' && { voice: v.regName }),
    };
    // key on the API root (not the /audio route) and, for clones, on the sample (not the registered name)
    const keyBody = v.kind === 'clone' ? { ...body, voice: `sample:${v.id}` } : body;
    return generate(body, hash(base.replace(/\/audio$/, ''), keyBody), file, v.kind === 'clone' ? v : null);
  };

  async function generate(body, id, file, clone) {
    if (await cache.fresh(file, id)) return file;
    if (clone && !registered.has(clone.regName)) await register(clone);
    let res = await post(body);
    if (clone && res.status === 400 && /unknown voice/i.test(await res.clone().text())) {
      await register(clone); // the engine unloaded and forgot the clone
      res = await post(body);
    }
    if (!res.ok) throw new Error(`TTS ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    await cache.record(file, id);
    return file;
  }
}
