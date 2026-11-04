# Deck

Markdown slides rendered by a small Node CLI (`src/`) to **HTML, PDF and a
narrated MP4**. [Marp Core](https://marpit.marp.app/) is used as the Markdown →
slides engine (so Marp syntax, directives and themes work); everything else
(HTML player, presenter mode, PDF, video) is in this repo.

## Install

The package is not published to npm; install it from GitHub (Node ≥ 20):

```bash
npm install -g github:meefik/deck             # the `deck` command, globally
npm install -D github:meefik/deck             # or as a dependency of your project (then `npx deck`)
npx github:meefik/deck make my-talk           # or run it once without installing
npm install -g github:meefik/deck#v0.1.0      # pin a tag, branch or commit
```

To hack on it, clone the repo and run `npm install` inside; `npm run deck --` is
then the same as `deck` (e.g. `npm run deck -- make --pdf`).

## Usage

```bash
deck init my-talk                   # new deck: my-talk/slides.md (a copy of the template) + assets/
deck make my-talk                   # ./output/slides.html
deck make my-talk --pdf --video     # + slides.pdf and slides.mp4 (voice-over, avatars)
```

Options: `--pdf`, `--video`, `--slides 1-2` (just those slides),
`-o out` (the output directory), and a `[dir]` with the deck. `[dir]` is a
directory with `slides.md` and (optionally) `assets/`, `themes/*.css`,
`avatars/` and `voices/`. If omitted it is the current folder when that has a
`slides.md`, otherwise the bundled `template/`. The output directory defaults
to `./output`. `slides.html` is always written; the PDF and the video are opt-in.
If `deck` is installed as a project dependency rather than globally, prefix the
commands with `npx` (`npx deck make --pdf`).

Output directory:

| File | Notes |
| --- | --- |
| `slides.html` | standalone player + `assets/` copy; always written (the PDF and video are rendered from it) |
| `slides.pdf` | `--pdf`: one page per slide, all reveals shown |
| `slides.mp4` | `--video`: 1920×1080, one still per slide + voice-over, fades between slides (`slides-<list>.mp4` with `--slides`; commas become `_`: `1,3,5-7` → `slides-1_3_5-7.mp4`) |
| `slides/slideNN.png` | `--video`: a 1920×1080 frame per slide |
| `voiceovers/slideNN.wav` | `--video`: the voice-over per slide |
| `avatars/slideNN.mp4` | `--video`, with avatars: the generated head per slide |
| `segments/slideNN.mkv` | `--video`: the encoded clip per slide (reused while unchanged), joined into the mp4; `list.txt` is the join list |
| `.cache.json` | what the generated files were made from (don't edit) |

PDF and video need Chrome, Chromium or Edge (set `CHROMIUM_PATH` if it is not on
`PATH`); video also needs `ffmpeg`/`ffprobe`. The themes in `template/themes/`
(`modern`, which uses system fonts, so decks build offline) are always available; a `themes/` folder inside `[dir]` adds to or
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
files). `deck make --video` narrates each slide through an OpenAI-compatible
`/audio/speech` API (default: **qwentts**, model `qwen-tts`, on a local service) and can put a talking head on each slide:

```bash
deck make --video
deck make --video --slides 1-2     # just slides 1-2, for review
```

The CLI has `-o`, `--pdf`, `--video` and `--slides`. **Everything else about the voice and the avatar
is set in the header of `slides.md`** (the front matter), so a deck builds the
same way for everyone. It is one voice and one face for the whole deck; a
`voice` or `avatar` comment on a single slide is an error:

```yaml
---
marp: true
theme: modern
voice: maria                    # a sample name or a description
silent-duration: 3              # seconds shown for slides without notes
avatar: maria                   # a file in avatars/ ("none" or omitted = no avatar)
tts-model: qwen-tts
tts-speed: 1                    # not used by qwen-tts
avatar-size: 512                # generated head, px (2..1920)
avatar-diameter: 0.26           # on screen, fraction of the frame height
avatar-position: top-right      # top-left, bottom-right, bottom-left
avatar-border: 6                # px at 1080p, scales with the frame; 0 = none
avatar-border-color: black      # white, black, "#rgb", "#rrggbb" (quote hex values: an unquoted # is a YAML comment)
---
```

All keys are optional (the values above are the defaults, except `voice`
and `avatar`); a wrong value fails the build and names the key.

**The services are set in the environment**, not in the deck, because the
addresses depend on the machine:

| Variable | Default |
| --- | --- |
| `DECK_TTS_URL` | `http://127.0.0.1:8010/v1/audio` (requests go to `<url>/speech`) |
| `DECK_AVATAR_URL` | `http://127.0.0.1:8010/v1/video` |
| `DECK_TTS_KEY` | – (API key for the voice-over service, if it needs one) |
| `DECK_AVATAR_KEY` | – (API key for the talking-head service, if it needs one) |

A `tts-url` or `avatar-url` key in the header is an error that points here.

**Voices.** qwentts has no fixed voice list, so a voice is a *sample* that gets
cloned. Samples live in `voices/` (`[dir]/voices/` first, then `template/voices/`):
`<name>.wav` (10-15 s, one clean speaker) plus `<name>.txt` (what it says). The
template ships `maria` (female) and `leon` (male). Create your own from a
description, once:

```bash
deck voice maria template --describe "warm, calm female narrator" --force   # -> template/voices/maria.wav (replaces the bundled one)
deck voice anna ./my-talk --describe "young, upbeat voice"          # -> ./my-talk/voices/anna.wav
```

Without `[dir]` it writes into the current folder, but only if that has a
`slides.md`. `[dir]` must exist; `template` always means the bundled template
(it never writes there unless you name it).
Use `--force` to replace a sample (that changes the voice for every deck that
uses it) and `--text` to change what it says. `--tts-seed <n>` fixes the seed, so the same
description gives the same voice again. The service is `DECK_TTS_URL`.

Name the sample as `voice:` in the header.

Every slide is then spoken by a clone of the same sample, so the voice stays the
same across the deck. Clones live in the engine's memory only; the build
registers them when needed and again if the engine forgot them. An unknown
name fails the build and lists the samples. A value with spaces ("warm, calm
female narrator") is treated as a description and designed fresh for every
slide, which is quicker to try but drifts a little between slides. Other
models work too: with e.g. `tts-model: kokoro` the voice is a voice name
(`af_bella`) and `tts-speed` applies. Voice-overs are stored as wav.

Notes are normalised for speech (numbers and `%` spelled out, markup stripped).
Generated files are kept in the output directory (see above). `<out>/.cache.json`
records what each was generated from, so editing one slide only re-synthesizes
that slide.

## Avatar

Set `avatar:` in the header to put a talking head on every slide (leave it out,
or write `avatar: none`, for no avatar):

```yaml
---
avatar: maria
---
```

The name is a portrait in `avatars/` (`png`, `jpg` or `webp`; `[dir]/avatars/`
first, then `template/avatars/`). An unknown name fails the build and lists the
available ones. Avatars only appear in the video: each slide's voice-over and
portrait are sent to the avatar (talking-head) service, and the lip-synced head
video is composited as a circle with a border in a corner of that slide (the
`avatar-*` header keys above set where, how big, and the border). The border
color is for light slides; dark slides (`invert`, `lead`) get
the inverse color.

The service is an async task API (`POST <DECK_AVATAR_URL>/generate` → poll
`<DECK_AVATAR_URL>/query` → `GET /v1/video/<task_id>`). The first request after an idle gap
cold-starts the engine (1–2 min), and generation runs at roughly 5× realtime,
one job at a time, so a full deck takes a while. Heads are cached in
`<out>/avatars/` and reused while the portrait and audio are unchanged. Slides
without notes get no avatar.

## Files

- `template/` — default input: `slides.md`, `assets/`, `avatars/` (faces), `voices/` (voice samples), `themes/modern.css`
- `src/cli.js` — commands (`make`, `init`, `voice`) and options
- `src/config.js` — header (front matter) settings and their validation
- `src/color.js` — color parsing for the avatar border
- `src/cache.js` — the `.cache.json` manifest of generated files
- `src/render.js` — Markdown → slides, HTML page, assets
- `src/runtime/` — player script and CSS inlined into `slides.html`
- `src/pdf.js`, `src/browser.js` — PDF export via headless Chrome
- `src/notes.js`, `src/tts.js`, `src/voices.js`, `src/avatar.js`, `src/video.js` — voice-over, avatar and video pipeline
- `SKILL.md` — instructions for AI agents using this CLI

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
| `<!-- _class: compact -->` | Denser table (smaller text and padding) for many or long rows |
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

## License

MIT — see [LICENSE](LICENSE).
