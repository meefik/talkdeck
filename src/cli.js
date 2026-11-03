#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { renderDeck, writeHtml, TEMPLATE_DIR } from './render.js';
import { writePdf } from './pdf.js';
import { writeVideo } from './video.js';
import { resolveAvatar } from './avatar.js';
import { serve } from './dev.js';
import { createVoiceSample } from './voices.js';

const log = (m) => console.log(m);
const exists = (p) => access(p).then(() => true, () => false);

const env = (name) => process.env[name];
// service addresses come from the environment (they depend on the machine, not on the deck)
const ttsUrl = () => env('DECK_TTS_URL') ?? 'http://127.0.0.1:8010/v1/audio';
const avatarUrl = () => env('DECK_AVATAR_URL') ?? 'http://127.0.0.1:8010/v1/video';

/**
 * The deck folder: the one given, else the current folder if it has a slides.md,
 * else (build, dev) the bundled template/.
 */
async function deckDir(input, { fallbackToTemplate }) {
  if (input) return path.resolve(input);
  if (await exists(path.resolve('slides.md'))) return path.resolve('.');
  if (fallbackToTemplate) return TEMPLATE_DIR;
  throw new Error('no deck folder: run this inside a folder with slides.md, or pass [dir] (e.g. "template")');
}

/** Shared by build and video: render slides.md to <out>/slides.html (+ assets/). */
async function render(o, input) {
  const dir = await deckDir(input, { fallbackToTemplate: true });
  if (!(await exists(path.join(dir, 'slides.md')))) throw new Error(`no slides.md in ${dir}`);
  const out = path.resolve(o.out ?? 'output');
  await mkdir(out, { recursive: true });
  const deck = await renderDeck(dir);
  return { deck, dir, out, html: await writeHtml(deck, dir, out) };
}

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

const COMMANDS = {
  build: {
    summary: 'render slides.md to HTML, and optionally PDF and a narrated video',
    usage: 'deck build [dir] [options]',
    options: {
      out: { type: 'string', short: 'o' },
      pdf: { type: 'boolean' },
      video: { type: 'boolean' },
      slides: { type: 'string' },
    },
    help: `
dir: the deck folder with slides.md, assets/, themes/, avatars/ and voices/.
Default: the current folder if it has a slides.md, else the bundled template/.
Themes, avatars and voices in template/ are always available; dir adds to or overrides them.

  -o, --out <dir>          output directory (default: ./output)
      --pdf                also write slides.pdf (needs Chrome/Chromium/Edge, or CHROMIUM_PATH)
      --video              also write slides.mp4 (needs Chrome/Chromium/Edge and ffmpeg)
      --slides <list>      with --video: just these slides, e.g. 1-2 or 1,3,5-7 (for review);
                           written to slides-<list>.mp4, files keep the full-deck numbers

Always writes slides.html (a standalone player with presenter mode) and a copy of assets/.
The video is 1920x1080, one still per slide plus its voice-over (the speaker notes, i.e. the
HTML comments, are the script), with the avatar on top. It also leaves slides/slideNN.png,
voiceovers/slideNN.wav, avatars/slideNN.mp4 and segments/slideNN.mkv in the output folder. Generated files are cached
there (.cache.json), so editing a slide only regenerates that slide.

The video is set up in the slides.md header (front matter), for the whole deck (one voice, one face):

  voice: maria              the voice: a sample name from voices/ (cloned, so it is the same on every
                            slide; create one with "deck voice"), or a description ("warm, calm
                            female narrator"; designed fresh per slide, drifts a little), or nothing =
                            the default narrator. Other TTS models: a voice name (af_bella).
  avatar: maria             the face: an image file in avatars/ (or "none"); no avatar if omitted
  tts-model: qwen-tts       tts-speed: 1 (not used by qwen-tts)
  silent-duration: 3        seconds shown for slides without notes
  avatar-size: 512          generated head size in px, 2..1920
  avatar-diameter: 0.26     on-screen diameter, fraction of the frame height
  avatar-position: top-right   or top-left, bottom-right, bottom-left
  avatar-border: 6          border width in px at 1080p (0 = none)
  avatar-border-color: black   white, black, "#rgb" or "#rrggbb" (quoted) on light slides; dark slides
                            (invert, lead) get the inverse color
Voices and avatars are looked up in dir/ first, then in template/. They cannot be set per slide
(a voice or avatar comment on a slide is an error).
The services are set in the environment, not in the deck:
  DECK_TTS_URL     voice-over API base   (default http://127.0.0.1:8010/v1/audio; requests go to <url>/speech)
  DECK_AVATAR_URL  talking-head API base (default http://127.0.0.1:8010/v1/video)
  DECK_TTS_KEY     API key for the voice-over service, if it needs one
  DECK_AVATAR_KEY  API key for the talking-head service, if it needs one
Avatar generation is slow (~5x realtime, one job at a time).`,
    async run(o, [input]) {
      if (o.slides && !o.video) throw new Error('--slides only applies to the video: add --video');
      const { deck, dir, out, html } = await render(o, input);
      const { tts, avatar } = deck.config;
      const only = o.slides && parseSlides(o.slides, deck.notes.length);
      log(`${deck.notes.length} slides`);
      log(`html   ${html}`);

      if (o.pdf) {
        const pdf = path.join(out, 'slides.pdf');
        await writePdf(html, pdf);
        log(`pdf    ${pdf}`);
      }
      if (o.video) {
        const face = await resolveAvatar(avatar.name, {
          deckDir: dir,
          dirs: [path.join(dir, 'avatars'), path.join(TEMPLATE_DIR, 'avatars')],
        });
        const mp4 = await writeVideo({
          deck, htmlFile: html, outDir: out, log, only,
          name: only ? `slides-${o.slides.replace(/\s+/g, '').replace(/,/g, '_')}.mp4` : 'slides.mp4',
          silent: deck.config.silentDuration,
          avatar: face && { ...avatar, url: avatarUrl(), key: env('DECK_AVATAR_KEY'), files: deck.notes.map(() => face) },
          tts: { ...tts, url: ttsUrl(), key: env('DECK_TTS_KEY'), voiceDirs: [path.join(dir, 'voices'), path.join(TEMPLATE_DIR, 'voices')] },
        });
        log(`video  ${mp4}`);
      }
    },
  },

  dev: {
    summary: 'live preview with auto-reload',
    usage: 'deck dev [dir] [--port N]',
    options: { port: { type: 'string' } },
    help: `
dir: as for "deck build". Serves the deck at http://localhost:<port>/ and reloads when
slides.md, themes/ or assets/ change.

      --port <n>           env PORT (default 8081)`,
    async run(o, [input]) {
      const dir = await deckDir(input, { fallbackToTemplate: true });
      await serve(dir, Number(o.port ?? env('PORT') ?? 8081), log);
    },
  },

  voice: {
    summary: 'create a voice sample to clone (qwen-tts)',
    usage: 'deck voice <name> [dir] --describe "<text>" [options]',
    options: {
      describe: { type: 'string' },
      text: { type: 'string' },
      'tts-seed': { type: 'string' },
      force: { type: 'boolean' },
    },
    help: `
Designs a voice from a description and saves it as <dir>/voices/<name>.wav (+ <name>.txt, its
transcript). Use the name as "voice:" in the deck header: every slide is then spoken by a clone of
this sample, so the voice stays the same across the deck.

dir: the deck folder to write into. Default: the current folder if it has a slides.md; otherwise
it must be given (e.g. "deck voice maria template" for the bundled template).
The voice-over service is DECK_TTS_URL (and DECK_TTS_KEY).

      --describe <text>    the voice, e.g. "warm, calm female narrator" (required)
      --text <text>        what the sample says (default: a ~13 s neutral passage; 10-15 s clones best)
      --tts-seed <n>       fixed seed, to get the same voice again from the same description
      --force              replace an existing sample (changes the voice for every deck using it)`,
    async run(o, [name, input]) {
      if (!name || !o.describe) throw new Error('usage: deck voice <name> [dir] --describe "warm, calm female narrator"');
      if (!/^[\w.-]+$/.test(name)) throw new Error(`bad voice name "${name}" (letters, digits, _ . - only)`);
      const dir = await deckDir(input, { fallbackToTemplate: false });
      const seed = o['tts-seed'] === undefined ? undefined : Number(o['tts-seed']);
      if (seed !== undefined && !(Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31)) throw new Error(`bad --tts-seed "${o['tts-seed']}" (an integer from 0 to ${2 ** 31})`);
      const r = await createVoiceSample({
        url: ttsUrl(), key: env('DECK_TTS_KEY'), name, describe: o.describe, text: o.text, seed,
        dir: path.join(dir, 'voices'), force: o.force,
      });
      log(`voice  ${r.file}  (${r.seconds.toFixed(1)} s)`);
      if (r.seconds < 8 || r.seconds > 20) log('note: samples of 10-15 s clone best; use --text to adjust the length');
    },
  },
};

function topHelp() {
  const w = Math.max(...Object.values(COMMANDS).map((c) => c.usage.length));
  return `deck — render Markdown slides to HTML, PDF and video

Usage:
${Object.values(COMMANDS).map((c) => `  ${c.usage.padEnd(w)}  ${c.summary}`).join('\n')}

Run "deck <command> --help" for the options of a command.
`;
}

const [command, ...rest] = process.argv.slice(2);
const spec = COMMANDS[command];
if (!command || command === '--help' || command === '-h' || command === 'help') {
  process.stdout.write(topHelp());
  process.exit(0);
}
if (!spec) {
  console.error(`error: unknown command "${command}"\n\n${topHelp()}`);
  process.exit(1);
}

try {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { ...spec.options, help: { type: 'boolean', short: 'h' } },
  });
  if (values.help) {
    process.stdout.write(`${spec.usage}\n${spec.help}\n`);
    process.exit(0);
  }
  await spec.run(values, positionals);
} catch (e) {
  if (e.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
    const flag = e.message.match(/'(-[^']+)'/)?.[1] ?? 'option';
    console.error(`error: unknown option ${flag} for "deck ${command}" (see: deck ${command} --help)`);
  } else {
    console.error(`error: ${e.message}`);
  }
  process.exit(1);
}
