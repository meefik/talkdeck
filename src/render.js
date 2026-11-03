import { readFile, readdir, cp, mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marp } from '@marp-team/marp-core';
import container from 'markdown-it-container';
import { deckConfig, readFrontMatter } from './config.js';

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
 * Returns { html, css, notes, title, size, config } where `notes` is an
 * array (one entry per slide) of arrays of note lines (the HTML comments
 * that are not Marp directives), and `classes` (the class directive per slide).
 */
export async function renderDeck(dir) {
  const source = await readFile(path.join(dir, 'slides.md'), 'utf8');

  const marp = new Marp({ html: true, script: false }).use(divContainer);
  // `voice` and `avatar` are header settings. Registering them as Marp directives keeps a stray
  // `<!-- _voice: x -->` out of the speaker notes (it would be read aloud); we reject it below instead.
  for (const name of ['voice', 'avatar']) {
    marp.customDirectives.local[name] = (value) => ({ [name]: String(value) });
  }
  await addThemes(marp, BUNDLED_THEMES);
  await addThemes(marp, path.join(dir, 'themes'));

  const { html, css, comments } = marp.render(source);
  const directives = marp.markdown.parse(source, {})
    .filter((t) => t.type === 'marpit_slide_open')
    .map((t) => t.meta.marpitDirectives);
  const front = readFrontMatter(source);
  const config = deckConfig(front);
  directives.forEach((d, i) => {
    for (const name of ['voice', 'avatar']) {
      const expected = front[name] === undefined || front[name] === null ? undefined : String(front[name]);
      if (d[name] !== expected) {
        throw new Error(`slide ${i + 1}: "${name}" cannot be set per slide; set "${name}:" in the header of slides.md`);
      }
    }
  });
  const [, w, h] = html.match(/viewBox="0 0 (\d+) (\d+)"/) ?? [, 1280, 720];

  return {
    html,
    css,
    notes: comments,
    classes: directives.map((d) => String(d.class ?? '')), // per slide: the `class` directive
    title: typeof front.title === 'string' && front.title ? front.title : path.basename(path.resolve(dir)),
    config, // voice, tts and avatar settings from the front matter
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
