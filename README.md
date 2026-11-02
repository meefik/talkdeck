# Modern Deck

Markdown slides rendered by a small Node CLI (`src/`) to **HTML, PDF and a
narrated MP4**. [Marp Core](https://marpit.marp.app/) is used as the Markdown →
slides engine (so Marp syntax, directives and themes work); everything else
(HTML player, presenter mode, PDF, video) is in this repo.

## Usage

```bash
npm install
node src/cli.js build [dir]                 # <dir>/dist/slides.html + slides.pdf
node src/cli.js build [dir] -o out          # choose the output directory
node src/cli.js build [dir] --video         # also slides.mp4 (voice-over)
node src/cli.js dev [dir]                   # live preview, http://localhost:8081/
```

`[dir]` is a directory with `slides.md` and (optionally) `assets/` and
`themes/*.css`; it defaults to the bundled `template/`. It is also installable as a command: `npm link` → `deck build [dir]`.
`npm run build`, `npm run dev` and `npm run video` use the template.

Output directory:

| File | Notes |
| --- | --- |
| `slides.html` | standalone player + `assets/` copy; always written (PDF and video are rendered from it) |
| `slides.pdf` | one page per slide, all reveals shown |
| `slides.mp4` | 1920×1080, one still per slide + voice-over, fades between slides |
| `slides/slideNN.png` | video only: a 1920×1080 frame per slide |
| `voiceovers/slideNN.wav` | video only: the voice-over per slide |
| `avatars/slideNN.mp4` | video with avatars: the generated head per slide |
| `.cache.json` | what the generated files were made from (don't edit) |

PDF and video need Chrome, Chromium or Edge (set `CHROME_PATH` if it is not on
`PATH`); video also needs `ffmpeg`/`ffprobe`. The themes in `template/themes/`
(`modern`) are always available; a `themes/` folder inside `[dir]` adds to or
overrides them.

## HTML player and presenter mode

Keys: **→ ↓ Space PageDown** next, **← ↑ PageUp** previous, **Home/End**, **F**
fullscreen, **P** presenter window (current + next slide, notes, timer, `+/−`
zoom the notes). Click: left quarter = back, elsewhere = forward. The URL hash
(`#5`) follows the slide.

Speaker notes are plain HTML comments at the bottom of a slide, one per line:

```markdown
# Slide

visible content

<!-- This is the first note line. -->
<!-- And this is the second. -->
```

## Voice-overs and video

The same note comments are the script for the voice-over (no separate text
files). Each slide is narrated through an OpenAI-compatible `/audio/speech` API.
The default is **qwentts** (model `qwen-tts`) behind the local fleet door:

```bash
node src/cli.js build [dir] --video
node src/cli.js build [dir] --video --slides 1-2     # just slides 1-2, for review
```

| Option | Env | Default |
| --- | --- | --- |
| `--tts-url` | `DECK_TTS_URL` | `http://127.0.0.1:8010/v1` |
| `--tts-key` | `DECK_TTS_KEY` | – |
| `--tts-model` | `DECK_TTS_MODEL` | `qwen-tts` |
| `--voice` | `DECK_VOICE` | – (the default narrator) |
| `--tts-seed` | `DECK_TTS_SEED` | – (qwen-tts only) |
| `--speed` | `DECK_SPEED` | `1.0` (not used by qwen-tts) |
| `--silent <s>` | – | `3` (seconds for slides with no notes) |

**Voices.** qwentts has no fixed voice list: a voice is a *description*.
Without one you get the default narrator; with one (`warm, calm female
narrator`) the slide is spoken by a voice designed from it. Set it per slide
with a directive next to the notes, the same way as the avatar (`_voice` = this
slide, `voice` = this and the following slides, front matter = deck default;
`--voice` is used where there is none; `default` = back to the default narrator):

```markdown
<!-- _voice: deep, measured male narrator -->
<!-- Hi everyone, -->
```

A designed voice is generated fresh for every slide, so timbre can drift a
little between slides. Other models work too: with e.g. `--tts-model kokoro`
the voice is a voice name (`af_bella`) and `--speed` applies. Voice-overs are
stored as wav.

Notes are normalised for speech (numbers and `%` spelled out, markup stripped).
Generated files are kept in the output directory (see above). `<out>/.cache.json`
records what each was generated from, so editing one slide only re-synthesizes
that slide.

## Avatar

Each slide can have a talking head, chosen right where its voice-over text
lives, with a Marp directive:

```markdown
---
avatar: maria            # deck default (front matter)
---

<!-- _avatar: leon -->   <!-- this slide only -->
<!-- avatar: leon -->    <!-- this slide and the following ones -->
<!-- _avatar: none -->   <!-- no avatar on this slide -->
```

The name is a portrait in `avatars/` (`png`, `jpg` or `webp`; `[dir]/avatars/`
first, then `template/avatars/`). An unknown name fails the build and lists the
available ones. Avatars only appear in the video: each slide's voice-over and
portrait are sent to the avatar (talking-head) service, and the lip-synced head
video is composited as a circle with a border in a corner of that slide.

```bash
node src/cli.js build [dir] --video                 # uses the avatar directives
node src/cli.js build [dir] --avatar maria          # default face for slides without a directive (implies --video)
node src/cli.js build [dir] --video --no-avatar     # ignore the directives
```

The service is an async task API (`POST /v1/video/generate` → poll
`/v1/video/query` → `GET /v1/video/file`). The first request after an idle gap
cold-starts the engine (1–2 min), and generation runs at roughly 5× realtime,
one job at a time, so a full deck takes a while. Heads are cached in
`<out>/avatars/` and reused while the portrait and audio are unchanged. Slides without notes get no avatar.

| Option | Default |
| --- | --- |
| `--avatar-url` (`DECK_AVATAR_URL`) | `http://127.0.0.1:8010` |
| `--avatar-size` | `512` (generated px; 2..1920) |
| `--avatar-diameter` | `0.26` (fraction of frame height) |
| `--avatar-position` | `top-right` (`top-left`, `bottom-right`, `bottom-left`) |
| `--avatar-border` | `6` (px at 1080p, scales with the frame; `0` = no border) |
| `--avatar-border-color` | `black` on light slides (`white`, `black`, `#rgb`, `#rrggbb`); dark slides (`invert`, `lead`, `divider`, `quote`) get the inverse, so white by default |

## Files

- `template/` — default input: `slides.md`, `assets/`, `avatars/`, `themes/modern.css`
- `src/cli.js` — commands and options
- `src/render.js` — Markdown → slides, HTML page, assets
- `src/runtime/` — player script and CSS inlined into `slides.html`
- `src/pdf.js`, `src/browser.js` — PDF export via headless Chrome
- `src/notes.js`, `src/tts.js`, `src/avatar.js`, `src/video.js` — voice-over, avatar and video pipeline
- `src/dev.js` — live-reload preview server

## Cheatsheet

| Syntax | Effect |
| --- | --- |
| `<!-- _class: lead -->` | Title slide (gradient, centered) |
| `<!-- _class: invert -->` | Dark slide |
| `<!-- _class: invert divider -->` | Section divider |
| `<!-- _paginate: false -->` | Hide page number on this slide |
| `<!-- _header: "" -->` | Hide header on this slide |
| `![bg right:40%](img.png)` | Split slide with image |
| `![bg](img.png)` | Full-bleed background image |
| `* item` | Bullet that reveals step by step (HTML) |
| `<!-- one sentence per line -->` | Speaker note (presenter view) |
| `::: columns` … `:::` | Two columns (`columns three` for three) |
| `:::: stats` ⊃ `::: stat` | Big-number tiles; each tile is `### 15`, a label line, and an optional `*caption*` line (blank lines between them make no difference) |
| `::: card` … `:::` | Boxed content |
| `<!-- _class: quote -->` | Big statement: `> text` (use `**bold**` for gradient emphasis), then an attribution paragraph. Combine with `invert` |
| `:::: compare` ⊃ `::: card before` + `::: card after` | Before → after cards, each starting with a `###` label (blank lines around the markdown inside) |
| `:::: compare plain` | Same as compare but without the arrow, for pros / cons (`card after` = emphasised, `card before` = muted) |
| `<!-- _class: code -->` | Code slide: a fenced block under the title, optional caption paragraph after it. Combine with `invert` |
| `::: steps` + ordered list `1. **Title** text` | Numbered process with connectors (`steps vertical` for a vertical layout) |
| `::: figure` + `![](shot.png)` + caption paragraph | Framed screenshot: rounded border, shadow, centered caption (image is capped at 340px tall) |
| `::: agenda` + ordered list `1. **Section** text` | Agenda with large gradient numbers and divider lines |
| Markdown table | Styled table with a header row and zebra stripes (3–4 columns max) |
| `> text` on a regular slide | Callout box; put it after a paragraph |
| `![bg brightness:0.5 blur:6px](img.png)` | Full-bleed background with filters, so a title stays readable (`brightness`, `blur`, `opacity`, …) |

All of these are shown in `slides.md`.

### Containers

Wrap content in `::: class names` … `:::` instead of raw `<div>` tags. For nesting, give the outer fence more colons (`::::` around `:::`). This is built into `src/render.js`.

## Vertical layout

On titled slides the title stays at the top and the body is centered between
the title and the footer. The header's bottom margin makes the body look low,
so extra space is added below it. Tune it per slide with the
`--body-bottom-space` variable (default `32px`):

```markdown
<style scoped>section { --body-bottom-space: 56px; }</style>
```

Slides with `lead`, `divider` or `quote` are centered on the whole slide.

Directive reference: https://marpit.marp.app/directives
