import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const isFile = (p) => access(p).then(() => true, () => false);

// ~13 s of varied, neutral speech: enough for a stable clone (10-15 s of one clean speaker works best)
export const SAMPLE_TEXT =
  'Welcome to this presentation. Today I will walk you through the main ideas, one step at a time. ' +
  'Each slide covers a single topic, so you can follow along easily, and ask questions whenever something is unclear.';

/** Length of a PCM WAV in seconds, from the byte rate in its header (assumes a 44-byte header). */
function wavSeconds(wav) {
  const byteRate = wav.length >= 44 && wav.toString('latin1', 0, 4) === 'RIFF' ? wav.readUInt32LE(28) : 0;
  return (wav.length - 44) / (byteRate || 24000 * 2);
}

/** A voice sample is `<dir>/voices/<name>.wav` plus an optional `<name>.txt` with its transcript. */
export async function findVoice(name, dirs) {
  for (const d of dirs) {
    const wav = path.join(d, `${name}.wav`);
    if (await isFile(wav)) {
      const txt = await readFile(path.join(d, `${name}.txt`), 'utf8').catch(() => undefined);
      return { name, wav: await readFile(wav), text: txt?.trim() || undefined };
    }
  }
  return null;
}

export async function listVoices(dirs) {
  const names = new Set();
  for (const d of dirs) {
    for (const f of await readdir(d).catch(() => [])) if (f.endsWith('.wav')) names.add(path.parse(f).name);
  }
  return [...names].sort();
}

/**
 * Design a voice from a description and save it as a sample:
 * `<dir>/<name>.wav` + `<name>.txt`. The sample is what later gets cloned for every slide,
 * so the voice stays the same across the deck.
 */
export async function createVoiceSample({ url, key, name, describe, text = SAMPLE_TEXT, seed, dir, force }) {
  const wavFile = path.join(dir, `${name}.wav`);
  if (!force && (await isFile(wavFile))) throw new Error(`${wavFile} exists (use --force to replace it)`);
  const res = await fetch(`${url.replace(/\/+$/, '')}/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key && { Authorization: `Bearer ${key}` }) },
    body: JSON.stringify({
      model: 'qwen-tts-voicedesign', input: text, instructions: describe, response_format: 'wav',
      ...(seed !== undefined && { seed }),
    }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
  const wav = Buffer.from(await res.arrayBuffer());
  await mkdir(dir, { recursive: true });
  await writeFile(wavFile, wav);
  await writeFile(path.join(dir, `${name}.txt`), `${text}\n`);
  return { file: wavFile, seconds: wavSeconds(wav) };
}
