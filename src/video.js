import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { withBrowser } from './browser.js';
import { speechPerSlide } from './notes.js';
import { createTts } from './tts.js';
import { createAvatar, invertColor, isDarkSlide, parseColor } from './avatar.js';
import { openCache } from './cache.js';

const PAD = 1.0;    // silence after each voice-over, before the slide fades out (s)
const FADE = 0.3;   // fade in/out between interior slides (s)
const BOOKEND = 0.5; // first slide fades in from black, last fades out to black (s)

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => reject(e.code === 'ENOENT' ? new Error(`${cmd} not found; install ffmpeg`) : e));
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}\n${err.slice(-2000)}`))));
  });
}

const duration = async (file) =>
  parseFloat(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]));

/** Screenshot the given slides (all click-to-reveal items shown) as PNGs of the given width. */
async function captureFrames(htmlFile, size, outDir, width, indices) {
  await mkdir(outDir, { recursive: true });
  const scale = width / size.width;
  return withBrowser(async (open) => {
    const page = await open(htmlFile, { width: size.width, height: size.height, deviceScaleFactor: scale });
    const files = [];
    for (const i of indices) {
      await page.evaluate((n) => window.deck.go(n, Infinity), i);
      await new Promise((r) => setTimeout(r, 400)); // let reveal transitions settle
      const file = path.join(outDir, `slide${String(i + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: file });
      files.push(file);
    }
    return files;
  });
}

/**
 * Build slides.mp4: one still per slide, shown for the voice-over length + PAD,
 * with fades, concatenated in order. `only`: 0-based slide indices to include (default all);
 * files keep the numbers of the full deck. Slides without notes are silent for `silent` seconds.
 */
export async function writeVideo({ deck, htmlFile, outDir, tts, avatar, only, name = 'slides.mp4', silent = 3, width = 1920, log = console.log }) {
  const cache = await openCache(outDir);
  const num = (i) => String(i + 1).padStart(2, '0');
  const synth = createTts({ ...tts, cache });
  const speech = speechPerSlide(deck.notes);
  const head = avatar && createAvatar({ ...avatar, cache, log });

  const indices = only ?? deck.notes.map((_, i) => i);
  log('capturing slides');
  const frames = await captureFrames(htmlFile, deck.size, path.join(outDir, 'slides'), width, indices);
  const height = Math.round((width * deck.size.height) / deck.size.width / 2) * 2;

  const segments = [];
  for (const [k, i] of indices.entries()) {
    if (!speech[i]) {
      log(`slide ${i + 1}: no speaker notes, silent for ${silent}s`);
      segments.push({ index: i, frame: frames[k], audio: null, length: silent });
      await cache.remove(path.join(outDir, 'voiceovers', `slide${num(i)}.wav`)); // notes were removed
      continue;
    }
    log(`slide ${i + 1}: voice-over (${speech[i].length} chars${deck.voices?.[i] ? `, voice ${deck.voices[i]}` : ''})`);
    const audio = await synth(speech[i], path.join(outDir, 'voiceovers', `slide${num(i)}.wav`), deck.voices?.[i]);
    const spoken = await duration(audio);
    segments.push({ index: i, frame: frames[k], audio, length: spoken + PAD, speech: spoken });
  }

  // Heads after all voice-overs: the TTS and avatar services may share one GPU (one model at a time),
  // so alternating between them per slide would reload models every time.
  if (head) {
    for (const seg of segments) {
      const i = seg.index;
      const file = path.join(outDir, 'avatars', `slide${num(i)}.mp4`);
      if (!seg.audio || !avatar.files[i]) {
        await cache.remove(file); // avatar was removed from this slide
        continue;
      }
      log(`slide ${i + 1}: avatar ${path.basename(avatar.files[i])}`);
      seg.head = await head(avatar.files[i], seg.audio, file);
    }
  }

  // drop files left over from a longer version of the deck (or from an older format)
  for (const dir of ['slides', 'voiceovers', 'avatars']) {
    for (const f of await readdir(path.join(outDir, dir)).catch(() => [])) {
      const m = f.match(/^slide(\d+)\./);
      if ((m && Number(m[1]) > deck.notes.length) || (dir === 'voiceovers' && !f.endsWith('.wav'))) {
        await cache.remove(path.join(outDir, dir, f));
      }
    }
  }

  const n = segments.length;
  const total = segments.reduce((s, x) => s + x.length, 0);
  const chains = [];
  const args = ['-y', '-v', 'error'];
  // Avatar: the head video as a circle in a corner (its last frame stays up once it ends), scaled to a fraction of the frame height.
  const D = Math.round(((avatar?.diameter ?? 0.26) * height) / 2) * 2;
  const bw = Math.round(((avatar?.border ?? 6) * height) / 1080);       // border width (px, 6 at 1080p); 0 = none
  const inner = D - 2 * bw;
  // the border color is for light slides; dark ones (invert, lead, ...) get its inverse
  const borderLight = parseColor(avatar?.borderColor ?? 'black');
  const borderDark = invertColor(borderLight);
  const margin = Math.round(height * 0.03);
  const [vert, horiz] = (avatar?.position ?? 'top-right').split('-');
  const ox = horiz === 'left' ? margin : `W-w-${margin}`;
  const oy = vert === 'top' ? margin : `H-h-${margin}`;
  // circular alpha with a 1px soft edge
  const circle = "a='clip(255*(W/2-hypot(X-W/2,Y-H/2)),0,255)'";
  const keep = "lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)'";
  let k = 0; // next input index
  segments.forEach((s, i) => {
    const fin = n === 1 || i === 0 ? BOOKEND : FADE;
    const fout = n === 1 || i === n - 1 ? BOOKEND : FADE;
    args.push('-loop', '1', '-framerate', '30', '-t', s.length.toFixed(3), '-i', s.frame);
    const base = k++;
    let from = `[${base}:v]scale=${width}:${height},setsar=1,format=yuv420p`;
    if (s.head) {
      args.push('-i', s.head);
      const h = k++;
      chains.push(
        `[${h}:v]setpts=PTS-STARTPTS,scale=${inner}:${inner},format=yuva420p,geq=${keep}:${circle}[h${i}]`);
      let badge = `h${i}`;
      if (bw > 0) {
        chains.push(`color=c=${isDarkSlide(deck.classes?.[s.index]) ? borderDark : borderLight}:s=${D}x${D}:r=30:d=${s.length.toFixed(3)},format=yuva420p,geq=${keep}:${circle}[r${i}]`);
        chains.push(`[r${i}][h${i}]overlay=x=${bw}:y=${bw}:eof_action=repeat:format=auto[hb${i}]`);
        badge = `hb${i}`;
      }
      chains.push(`${from}[b${i}]`);
      from = `[b${i}][${badge}]overlay=x=${ox}:y=${oy}:eof_action=repeat:format=auto,format=yuv420p`;
    }
    chains.push(`${from},fade=t=in:st=0:d=${fin},fade=t=out:st=${(s.length - fout).toFixed(3)}:d=${fout}[v${i}]`);
    if (s.audio) args.push('-i', s.audio);
    else args.push('-f', 'lavfi', '-t', s.length.toFixed(3), '-i', 'anullsrc=r=44100:cl=mono');
    const padDur = Math.max(0, s.length - (s.speech ?? 0)).toFixed(3);
    chains.push(`[${k++}:a]aresample=44100,aformat=channel_layouts=mono,apad=pad_dur=${padDur}[a${i}]`);
  });
  const filter = `${chains.join(';')};${segments.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${n}:v=1:a=1[vout][aout]`;

  const file = path.join(outDir, name);
  log(`encoding ${total.toFixed(1)}s of video`);
  await run('ffmpeg', [...args, '-filter_complex', filter, '-map', '[vout]', '-map', '[aout]', '-r', '30',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', '-t', total.toFixed(3), file]);
  return file;
}
