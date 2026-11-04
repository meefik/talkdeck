import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hash } from './cache.js';

const POLL_MS = 5000;
const SUBMIT_TIMEOUT_MS = 300_000;  // the first call after an idle gap cold-starts the engine (~1-2 min)
const POLL_TIMEOUT_MS = 1_800_000;
const QUERY_TIMEOUT_MS = 60_000;

/**
 * Talking-head generation via the avatar service (async task API):
 * POST <base>/generate (portrait + audio) -> task_id, POST <base>/query until
 * status is 1 (done) / 2 (failed), then GET the result's `file` path (/v1/video/<task_id>).
 * One portrait per call (the same face for the whole deck). `generate` writes `file`, unless
 * `cache` says it was already generated from the same portrait and audio.
 *
 * `url` is the video API base, e.g. http://127.0.0.1:8010/v1/video; `key`, if set, is sent as a Bearer token.
 */
export function createAvatar({ url, key, size, cache, log = () => {} }) {
  const base = url.replace(/\/+$/, '');

  async function call(method, route, init = {}) {
    let res;
    try {
      res = await fetch(route.startsWith('http') ? route : base + route, {
        method,
        ...init,
        headers: { ...(key && { Authorization: `Bearer ${key}` }), ...init.headers },
      });
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
    const res = await call('POST', '/generate', { body: form, signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS) });
    const { task_id: id } = await res.json();
    if (!id) throw new Error('avatar: no task_id in response');
    return id;
  }

  async function poll(id) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const res = await call('POST', '/query', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id_list: [id] }),
        signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
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
    // `file` is an opaque path, "/v1/video/<task_id>" (a legacy "/v1/video/file?path=..." also works): GET it from
    // the same server. Drop any scheme+host, which could be the engine's own unreachable loopback.
    if (!result?.file) throw new Error(`avatar: succeeded task has no downloadable file: ${JSON.stringify(item).slice(0, 300)}`);
    const { pathname, search } = new URL(result.file, base);
    const video = await call('GET', new URL(pathname + search, base).href, { signal: AbortSignal.timeout(120_000) });
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(await video.arrayBuffer()));
    await cache.record(file, id);
    return file;
  };
}

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
const isFile = (p) => access(p).then(() => true, () => false);

/**
 * Resolve the avatar name from the header to a portrait file: a name from the avatars/ folders
 * (first dir wins), or a path relative to the deck dir. Returns null for no name or 'none'.
 */
export async function resolveAvatar(name, { deckDir, dirs }) {
  if (!name || name === 'none') return null;
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
}

// Slides whose background is dark: the `invert` theme, and the gradient layouts.
const DARK = ['invert', 'lead']; // divider and quote are light unless combined with invert
export const isDarkSlide = (classes) => String(classes ?? '').split(/\s+/).some((c) => DARK.includes(c));
