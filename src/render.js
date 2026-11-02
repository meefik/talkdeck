import { readFile, readdir, cp, mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marp } from '@marp-team/marp-core';
import container from 'markdown-it-container';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TEMPLATE_DIR = path.resolve(HERE, '..', 'template');
const BUNDLED_THEMES = path.join(TEMPLATE_DIR, 'themes');

const exists = (p) => access(p).then(() => true, () => false);

// Lets slides use `::: class names` ... `:::` instead of raw <div> tags.
// Nest by giving the outer fence more colons (e.g. `::::` around `:::`).
function divContainer(md) {
  md.use(container, 'div', {
    marker: ':',
    validate: (params) => params.trim().length > 0,
    render: (tokens, idx) =>
      tokens[idx].nesting === 1
        ? `<div class="${md.utils.escapeHtml(tokens[idx].info.trim())}">\n`
        : '</div>\n',
  });
}

async function addThemes(marp, dir) {
  if (!(await exists(dir))) return;
  for (const f of (await readdir(dir)).sort()) {
    if (f.endsWith('.css')) marp.themeSet.add(await readFile(path.join(dir, f), 'utf8'));
  }
}

/**
 * Read `<dir>/slides.md` and render it.
 * Returns { html, css, notes, title, size, assetsDir } where `notes` is an
 * array (one entry per slide) of arrays of note lines (the HTML comments
 * that are not Marp directives), and the `avatars` / `voices` directives per slide.
 */
export async function renderDeck(dir) {
  const source = await readFile(path.join(dir, 'slides.md'), 'utf8');

  const marp = new Marp({ html: true, script: false }).use(divContainer);
  // `<!-- _avatar: name -->` (this slide) / `<!-- avatar: name -->` (this and following slides),
  // likewise `voice`. Registering them keeps the directives out of the speaker notes.
  for (const name of ['avatar', 'voice']) {
    marp.customDirectives.local[name] = (value) => ({ [name]: String(value) });
  }
  await addThemes(marp, BUNDLED_THEMES);
  await addThemes(marp, path.join(dir, 'themes'));

  const { html, css, comments } = marp.render(source);
  const directives = marp.markdown.parse(source, {})
    .filter((t) => t.type === 'marpit_slide_open')
    .map((t) => t.meta.marpitDirectives);
  const front = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  const title = front.match(/^title:\s*(.+?)\s*$/m)?.[1].replace(/^(["'])(.*)\1$/, '$2');
  const [, w, h] = html.match(/viewBox="0 0 (\d+) (\d+)"/) ?? [, 1280, 720];

  return {
    html,
    css,
    notes: comments,
    avatars: directives.map((d) => d.avatar), // per slide: name, 'none', or undefined
    voices: directives.map((d) => d.voice),   // per slide: voice name or undefined
    classes: directives.map((d) => String(d.class ?? '')), // per slide: the `class` directive
    title: title || path.basename(path.resolve(dir)),
    size: { width: Number(w), height: Number(h) },
  };
}

const read = (name) => readFile(path.join(HERE, 'runtime', name), 'utf8');
const escapeScriptJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Wrap a rendered deck into a standalone HTML page (player + presenter mode). */
export async function toPage(deck) {
  const [playerCss, playerJs] = await Promise.all([read('player.css'), read('player.js')]);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(deck.title)}</title>
<style>${deck.css}</style>
<style>${playerCss}</style>
</head>
<body>
${deck.html}
<script type="application/json" id="deck-notes">${escapeScriptJson(deck.notes)}</script>
<script>${playerJs}</script>
</body>
</html>
`;
}

/** Write slides.html and copy assets/ next to it. */
export async function writeHtml(deck, dir, outDir) {
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, 'slides.html');
  await writeFile(file, await toPage(deck));
  const assets = path.join(dir, 'assets');
  if (await exists(assets)) await cp(assets, path.join(outDir, 'assets'), { recursive: true });
  return file;
}
