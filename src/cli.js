#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { renderDeck, writeHtml, TEMPLATE_DIR } from './render.js';
import { writePdf } from './pdf.js';
import { writeVideo } from './video.js';
import { resolveAvatars, parseColor } from './avatar.js';
import { serve } from './dev.js';

const HELP = `deck — render Markdown slides to HTML, PDF and video

Usage:
  deck build [dir] [options]   dir contains slides.md, assets/ and themes/
  deck dev [dir] [--port N]    live preview with auto-reload

dir defaults to the bundled template/. Themes from template/themes are always
available; dir/themes adds to (or overrides) them.

Build options:
  -o, --out <dir>       output directory (default: <dir>/dist)
      --formats <list>  comma list of html,pdf,video (default: html,pdf)
      --video           shorthand for adding "video" to --formats
      --slides <list>   video only: render just these slides, e.g. 1-2 or 1,3,5-7 (for review);
                        written to slides-<list>.mp4, files keep the full-deck numbers

Video options (voice-over via an OpenAI-compatible /audio/speech API, qwentts by default):
      --tts-url <url>   env DECK_TTS_URL   (default http://127.0.0.1:8010/v1)
      --tts-key <key>   env DECK_TTS_KEY
      --tts-model <m>   env DECK_TTS_MODEL (default qwen-tts)
      --voice <v>       env DECK_VOICE     default voice; per slide: <!-- _voice: v --> (this slide)
                        or <!-- voice: v --> (this and the following slides)
                        qwen-tts: a description of the voice, e.g. "warm, calm female narrator"
                        (none = the default narrator); other models: a voice name, e.g. af_bella
      --tts-seed <n>    env DECK_TTS_SEED  qwen-tts only: sampling seed
      --speed <n>       env DECK_SPEED     (default 1.0; not used by qwen-tts)
      --silent <sec>    seconds shown for slides without notes (default 3)

Avatar (talking head composited as a circle on a slide; used with video):
  Pick the face per slide with a Marp directive next to the notes:
      <!-- _avatar: maria -->   this slide      <!-- avatar: leon -->   this and the following slides
      <!-- _avatar: none -->    no avatar        (front matter "avatar: maria" sets a deck default)
  Names are files in avatars/ (png/jpg/webp) of dir or template/.
      --avatar <name>           default face for slides without a directive (implies --video)
      --no-avatar               ignore avatar directives
      --avatar-url <url>        env DECK_AVATAR_URL (default http://127.0.0.1:8010)
      --avatar-size <px>        generated head size, 2..1920 (default 512)
      --avatar-diameter <frac>  on-screen diameter as a fraction of frame height (default 0.26)
      --avatar-position <pos>   top-right (default), top-left, bottom-right, bottom-left
      --avatar-border <px>      border width in px at 1080p (default 6, 0 = none)
      --avatar-border-color <c> border color on light slides: white, black, #rgb or #rrggbb (default black);
                                dark slides (invert, lead, divider, quote) get the inverse color
  Generation is slow (~5x realtime, one job at a time) and cached by content.

PDF and video need Chrome/Chromium/Edge (or CHROME_PATH); video also needs ffmpeg.
Speaker notes are the HTML comments at the end of each slide.
`;

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o' },
    formats: { type: 'string' },
    video: { type: 'boolean' },
    slides: { type: 'string' },
    port: { type: 'string' },
    'tts-url': { type: 'string' },
    'tts-key': { type: 'string' },
    'tts-model': { type: 'string' },
    voice: { type: 'string' },
    'tts-seed': { type: 'string' },
    speed: { type: 'string' },
    silent: { type: 'string' },
    avatar: { type: 'string' },
    'no-avatar': { type: 'boolean' },
    'avatar-url': { type: 'string' },
    'avatar-size': { type: 'string' },
    'avatar-diameter': { type: 'string' },
    'avatar-position': { type: 'string' },
    'avatar-border': { type: 'string' },
    'avatar-border-color': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

const [command, input] = positionals;
if (o.help || !command || !['build', 'dev'].includes(command)) {
  process.stdout.write(HELP);
  process.exit(o.help || !command ? 0 : 1);
}

const dir = input ? path.resolve(input) : TEMPLATE_DIR;
const log = (m) => console.log(m);

function parseSlides(spec, total) {
  const set = new Set();
  for (const part of spec.split(',')) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`bad --slides "${spec}" (use e.g. 1-2 or 1,3,5-7)`);
    const [a, b] = [Number(m[1]), Number(m[2] ?? m[1])];
    if (a < 1 || b < a || b > total) throw new Error(`--slides ${part}: must be within 1-${total}, lowest first`);
    for (let i = a; i <= b; i++) set.add(i - 1);
  }
  return [...set].sort((x, y) => x - y);
}

async function build() {
  const formats = new Set((o.formats ?? 'html,pdf').split(',').map((s) => s.trim()).filter(Boolean));
  if (o.video || o.slides || (o.avatar && !o['no-avatar'])) formats.add('video');
  if (!['bottom-right', 'bottom-left', 'top-right', 'top-left'].includes(o['avatar-position'] ?? 'top-right')) {
    throw new Error('--avatar-position must be bottom-right, bottom-left, top-right or top-left');
  }
  if (o['avatar-border-color']) parseColor(o['avatar-border-color']);
  const unknown = [...formats].filter((f) => !['html', 'pdf', 'video'].includes(f));
  if (unknown.length) throw new Error(`unknown format: ${unknown.join(', ')}`);

  const out = path.resolve(o.out ?? path.join(dir, 'dist'));
  await mkdir(out, { recursive: true });

  const deck = await renderDeck(dir);
  log(`${deck.notes.length} slides`);
  // pdf and video render from the html file, so it is always written
  const html = await writeHtml(deck, dir, out);
  log(`html   ${html}`);

  if (formats.has('pdf')) {
    const pdf = path.join(out, 'slides.pdf');
    await writePdf(html, pdf);
    log(`pdf    ${pdf}`);
  }
  if (formats.has('video')) {
    const only = o.slides && parseSlides(o.slides, deck.notes.length);
    const faces = o['no-avatar'] ? [] : await resolveAvatars(deck.avatars, {
      deckDir: dir,
      dirs: [path.join(dir, 'avatars'), path.join(TEMPLATE_DIR, 'avatars')],
      fallback: o.avatar,
    });
    const mp4 = await writeVideo({
      deck, htmlFile: html, outDir: out, log, only,
      name: only ? `slides-${o.slides.replace(/,/g, '_')}.mp4` : 'slides.mp4', silent: Number(o.silent ?? 3),
      avatar: faces.some(Boolean) && {
        files: faces,
        url: o['avatar-url'] ?? process.env.DECK_AVATAR_URL ?? 'http://127.0.0.1:8010',
        size: Number(o['avatar-size'] ?? 512),
        diameter: Number(o['avatar-diameter'] ?? 0.26),
        position: o['avatar-position'] ?? 'top-right',
        border: Number(o['avatar-border'] ?? 6),
        borderColor: o['avatar-border-color'] ?? 'black',
      },
      tts: {
        url: o['tts-url'] ?? process.env.DECK_TTS_URL ?? 'http://127.0.0.1:8010/v1',
        key: o['tts-key'] ?? process.env.DECK_TTS_KEY,
        model: o['tts-model'] ?? process.env.DECK_TTS_MODEL ?? 'qwen-tts',
        voice: o.voice ?? process.env.DECK_VOICE,
        seed: (o['tts-seed'] ?? process.env.DECK_TTS_SEED) === undefined ? undefined : Number(o['tts-seed'] ?? process.env.DECK_TTS_SEED),
        speed: Number(o.speed ?? process.env.DECK_SPEED ?? 1),
      },
    });
    log(`video  ${mp4}`);
  }
  if (!formats.has('html')) log('(slides.html is kept: it is the source for the other formats)');
}

try {
  if (command === 'build') await build();
  else await serve(dir, Number(o.port ?? process.env.PORT ?? 8081), log);
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exit(1);
}
