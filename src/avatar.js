import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hash } from './cache.js';

const POLL_MS = 5000;
const SUBMIT_TIMEOUT_MS = 300_000;  // the first call after an idle gap cold-starts the engine (~1-2 min)
const POLL_TIMEOUT_MS = 1_800_000;

/**
 * Talking-head generation via the avatar service (async task API):
 * POST /v1/video/generate (portrait + audio) -> task_id, POST /v1/video/query until
 * status is 1 (done) / 2 (failed), then GET /v1/video/file. One portrait per call (the
 * face is chosen per slide). `generate` writes `file`, unless `cache` says it was already generated from the same portrait and audio.
 */
export function createAvatar({ url, size, cache, log = () => {} }) {
  const base = url.replace(/\/+$/, '');

  async function call(method, route, init = {}) {
    let res;
    try {
      res = await fetch(base + route, { method, ...init });
    } catch (e) {
      throw new Error(`avatar service unreachable at ${base}: ${e.cause?.message ?? e.message}`);
    }
    if (!res.ok) throw new Error(`avatar ${route} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res;
  }

  async function submit(portrait, portraitBytes, audioBytes) {
    const form = new FormData();
    form.set('source', new Blob([portraitBytes]), path.basename(portrait));
    form.set('audio', new Blob([audioBytes]), 'voice.wav');
    form.set('format', 'mp4');
    form.set('size', String(size));
    const res = await call('POST', '/v1/video/generate', { body: form, signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS) });
    const { task_id: id } = await res.json();
    if (!id) throw new Error('avatar: no task_id in response');
    return id;
  }

  async function poll(id) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const res = await call('POST', '/v1/video/query', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id_list: [id] }),
      });
      const body = await res.json();
      let data = Array.isArray(body) ? body : body.data; // a list, or a {data} envelope
      if (data && !Array.isArray(data)) data = [data];
      const item = data?.[0];
      if (!item) continue;
      if (item.status === 1) return item;
      if (item.status === 2) throw new Error(`avatar task failed: ${JSON.stringify(item).slice(0, 500)}`);
    }
    throw new Error(`avatar task ${id} timed out`);
  }

  /** portrait (png/jpg) + audioFile (wav) -> head video (mp4, size x size) written to `file`. */
  return async function generate(portrait, audioFile, file) {
    const [portraitBytes, audioBytes] = await Promise.all([readFile(portrait), readFile(audioFile)]);
    const id = hash(portraitBytes, audioBytes, String(size));
    if (await cache.fresh(file, id)) return file;

    const task = await submit(portrait, portraitBytes, audioBytes);
    log(`  avatar task ${task} (the first one may take minutes: model cold start)`);
    const item = await poll(task);
    const result = typeof item.result === 'string' ? JSON.parse(item.result) : item.result;
    // `file` may carry a scheme+host that is the engine's own loopback; keep only ?path= and go through the door.
    const query = result?.file?.split('?')[1];
    if (!query) throw new Error(`avatar: succeeded task has no downloadable file: ${JSON.stringify(item).slice(0, 300)}`);
    const video = await call('GET', `/v1/video/file?${query}`, { signal: AbortSignal.timeout(120_000) });
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(await video.arrayBuffer()));
    await cache.record(file, id);
    return file;
  };
}

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
const isFile = (p) => access(p).then(() => true, () => false);

/**
 * Resolve the avatar directive of every slide to a portrait file (or null).
 * `names`: per slide, a name from avatars/, a path relative to the deck dir,
 * 'none', or undefined (falls back to `fallback`). `dirs`: avatar folders, first wins.
 */
export async function resolveAvatars(names, { deckDir, dirs, fallback }) {
  const cache = new Map();
  const find = async (name) => {
    for (const d of dirs) {
      for (const ext of ['', ...IMAGE_EXT]) {
        const f = path.join(d, name + ext);
        if (IMAGE_EXT.includes(path.extname(f).toLowerCase()) && (await isFile(f))) return f;
      }
    }
    const f = path.resolve(deckDir, name);
    if (IMAGE_EXT.includes(path.extname(f).toLowerCase()) && (await isFile(f))) return f;
    const known = [];
    for (const d of dirs) {
      try {
        known.push(...(await readdir(d)).filter((x) => IMAGE_EXT.includes(path.extname(x).toLowerCase())).map((x) => path.parse(x).name));
      } catch {}
    }
    throw new Error(`unknown avatar "${name}" (available: ${[...new Set(known)].join(', ') || 'none'})`);
  };
  const out = [];
  for (const raw of names) {
    const name = raw ?? fallback;
    if (!name || name === 'none') out.push(null);
    else {
      if (!cache.has(name)) cache.set(name, await find(name));
      out.push(cache.get(name));
    }
  }
  return out;
}

const NAMED = { white: '#ffffff', black: '#000000' };

/** '#rgb' | '#rrggbb' | 'rrggbb' | white | black -> '#rrggbb' (throws on anything else) */
export function parseColor(c) {
  let h = NAMED[String(c).toLowerCase()] ?? String(c);
  h = h.replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = [...h].map((x) => x + x).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`bad color "${c}" (use white, black, #rgb or #rrggbb)`);
  return `#${h.toLowerCase()}`;
}

export const invertColor = (c) =>
  '#' + [1, 3, 5].map((i) => (255 - parseInt(parseColor(c).slice(i, i + 2), 16)).toString(16).padStart(2, '0')).join('');

// Slides whose background is dark: the `invert` theme, and the gradient layouts.
const DARK = ['invert', 'lead', 'divider', 'quote'];
export const isDarkSlide = (classes) => String(classes ?? '').split(/\s+/).some((c) => DARK.includes(c));
