---
name: talkdeck
description: Build slide decks from Markdown with the `talkdeck` CLI from talkdeck (Marp Core + a small Node renderer). Use when asked to create, edit, preview or export a presentation, slides, or a narrated video of slides to HTML, PDF or MP4 with voice-over and an avatar, or to add speaker notes, voices or themes to a deck.
---

# Talkdeck generator

`slides.md` (Markdown, Marp syntax + extra containers) → `slides.html` (player with presenter mode), optionally `slides.pdf` and `slides.mp4` (voice-over from the speaker notes, optional talking-head avatar).

Use the `talkdeck` CLI (`talkdeck <command>`); do not invent other commands. Run `talkdeck <command> --help` for exact options. Commands: `init`, `make`, `voice`.

Setup: the package is not on npm, it is installed from GitHub (Node ≥ 22.12). Check `talkdeck --help` (or `npx talkdeck --help` in a project that has it as a dependency) first; if it is missing, install it:

```bash
npm install -g github:meefik/talkdeck      # global `talkdeck` command
npm install -D github:meefik/talkdeck      # or per project; then run it as `npx talkdeck`
npx github:meefik/talkdeck make [dir]      # or one-off, nothing installed
```

Inside a clone of the repo, run `npm install` once; `npm run talkdeck --` is the same as `talkdeck` there (e.g. `npm run talkdeck -- make --pdf`).

## Workflow

1. **Pick the deck folder.** A folder with `slides.md` and optional `assets/`, `themes/*.css`, `avatars/`, `voices/`. Create a new one with `talkdeck init my-talk` (copies the template's `slides.md` and `assets/` into `my-talk/`; refuses to overwrite an existing `slides.md`). With no `[dir]`, the CLI uses the current folder if it has a `slides.md`, otherwise the bundled `template/`. `template/` themes, avatars and voices are always available; the deck folder adds to or overrides them.
2. **Write `slides.md`.** Start from the copy `talkdeck init` made — it demonstrates every layout; copy the slide you need rather than writing HTML.
3. **Check the result.** Build and look at it (see below). Do not claim a layout works without building.
4. **Export** only what was asked.

## Commands

```bash
talkdeck init [dir]                       # new deck: slides.md + assets/ copied from the template
talkdeck make [dir]                       # ./output/slides.html (always written)
talkdeck make [dir] --pdf                 # + slides.pdf (one page per slide, reveals shown)
talkdeck make [dir] --video               # + slides.mp4 (1920x1080, voice-over, avatar)
talkdeck make [dir] --video --slides 1-2  # only these slides (1,3,5-7 also fine) → slides-1-2.mp4
talkdeck make [dir] -o out                # output directory (default ./output)
talkdeck voice <name> [dir] --describe "warm, calm female narrator" [--text ...] [--tts-seed N] [--force]
```

- With `npm run talkdeck`, the command and its options go **after `--`** (`npm run talkdeck -- make --pdf`); with `talkdeck` / `npx talkdeck` there is no `--`.
- `--slides` requires `--video`.
- `--pdf` needs Chrome/Chromium/Edge (set `CHROMIUM_PATH` if not on `PATH`); `--video` also needs `ffmpeg`/`ffprobe`.
- Output (`output/` is git-ignored): `slides.html`, `assets/`, `slides.pdf`, `slides.mp4` (`slides-<list>.mp4` with `--slides`; commas become `_`), `slides/slideNN.png`, `voiceovers/slideNN.wav`, `avatars/slideNN.mp4`, `segments/slideNN.mkv`, `.cache.json` (never edit it; it makes rebuilds regenerate only changed slides).

## Slide syntax

Slides are separated by `---`. Front matter must contain `marp: true` and `theme: modern` (the only built-in theme). Useful keys: `paginate`, `title`, `author`, `header`, `footer`.

Per-slide directives are HTML comments with an underscore, placed at the top of the slide:

| Syntax | Effect |
| --- | --- |
| `<!-- _class: lead -->` | Title slide. Usually with `_paginate: false`, `_header: ""`, `_footer: ""` |
| `<!-- _class: invert -->` | Dark slide (combinable: `invert divider`, `invert quote`, `invert code`) |
| `<!-- _class: divider -->` | Section divider (`# Title` + subtitle line) |
| `<!-- _class: quote -->` | `> statement` with `**bold**` gradient emphasis, then an attribution paragraph |
| `<!-- _class: code -->` | Fenced code under the title, optional caption paragraph after it |
| `* item` | Bullet revealed step by step in HTML (use `-` for static; PDF shows all) |
| `> text` after a paragraph | Callout box |
| `![bg right:40%](assets/x.svg)` | Split slide (`bg left`, `bg` = full bleed, filters: `bg brightness:0.5 blur:6px`) |
| Markdown table | Styled table; max 3–4 columns |
| `<!-- _class: compact -->` | Denser table (smaller text and padding) for many or long rows |
| `<style scoped>section { --body-bottom-space: 56px; }</style>` | Tune vertical centering (default 32px) |

Containers (`::: name` … `:::`; for nesting use more colons on the outer fence, `::::` around `:::`). Never use raw `<div>`:

- `:::: columns` ⊃ `::: col` (`columns three` for three) — columns; `::: card` — boxed content
- `:::: stats` ⊃ `::: stat` — each tile is `### 15`, a label line, optional `*caption*`
- `:::: compare` ⊃ `::: card before` + `::: card after`, each starting with a `###` label; `compare plain` has no arrow (pros/cons, `card after` is emphasised)
- `::: steps` + ordered list `1. **Title** text` (`steps vertical` for vertical)
- `::: agenda` + ordered list `1. **Section** text`
- `::: figure` + `![](shot.png)` + caption paragraph — framed screenshot (image capped at 340px tall)

Put blank lines around markdown inside containers. Reference images relative to the deck folder (`assets/...`). One idea per slide, 3–5 bullets, short lines — long content overflows the fixed 16:9 frame, so split slides instead of shrinking.

## Speaker notes = voice-over script

Notes are HTML comments at the bottom of a slide, **one sentence/line per comment**:

```markdown
## Slide title

content

<!-- First sentence of the narration. -->
<!-- Second sentence. -->
```

- They show in presenter mode (**P** in the HTML player) *and* are the script the TTS reads for `--video`. Write them as natural spoken English, not as a repeat of the slide text.
- Don't confuse them with directives: `_class`, `_paginate`, `_header`, `_footer` (underscore-prefixed) are directives, everything else is a note.
- The text is normalised for speech (digits and `%` spelled out, markup, `—`, `<tags>` stripped), but avoid symbols, code and abbreviations the engine can't pronounce; spell them as words.
- A slide without notes is silent: it is shown for `silent-duration` seconds and gets no avatar.
- Editing one slide's notes only re-synthesizes that slide (cache).

## Video settings (front matter only)

Voice and avatar are **per deck**, set in the `slides.md` header — one voice, one face. A `voice` or `avatar` comment on a single slide is an error. All keys optional; wrong values fail the build and name the key:

```yaml
voice: maria                    # a sample name in voices/, or a description ("warm, calm female narrator")
silent-duration: 3              # seconds for slides without notes
avatar: maria                   # file in avatars/ (png/jpg/webp); "none" or omitted = no avatar
tts-model: qwen-tts
tts-speed: 1                    # not used by qwen-tts
avatar-size: 512                # generated head, px (2..1920)
avatar-diameter: 0.26           # fraction of the frame height
avatar-position: top-right      # top-left, bottom-right, bottom-left
avatar-border: 6                # px at 1080p; 0 = none
avatar-border-color: black      # white, black, "#rgb", "#rrggbb" (quote hex: an unquoted # is a YAML comment; dark slides get the inverse)
```

- Bundled voices: `maria`, `leon`; bundled avatars: `maria`, `leon`. An unknown name fails the build and lists the available ones. Lookup is `[dir]/voices|avatars/` first, then `template/`.
- A named sample is cloned, so the voice stays identical across slides. A description is designed fresh per slide (quick to try, drifts). Create a sample once with `talkdeck voice` (needs an existing `[dir]` unless the current folder has `slides.md`; `template` means the bundled template; `--tts-seed` reproduces a voice; `--force` replaces one and changes every deck using it).
- Avatars only appear in the video.

## Services (environment, never the deck)

`tts-url` / `avatar-url` in the header is an error. Set these in the environment:

| Variable | Default |
| --- | --- |
| `TALKDECK_TTS_URL` | `http://127.0.0.1:8081/v1/audio` (OpenAI-compatible, requests go to `<url>/speech`) |
| `TALKDECK_AVATAR_URL` | `http://127.0.0.1:8082/v1/video` |
| `TALKDECK_TTS_KEY`, `TALKDECK_AVATAR_KEY` | API keys if the services need them |

Never put keys in the repo or in `slides.md`.

## Tips for agents

- HTML-only requests: `talkdeck make [dir]` is enough and needs no external service. Don't run `--video` unless asked; it calls local TTS/avatar services and avatar generation is slow (~5× realtime, one job at a time, 1–2 min cold start). While iterating on narration, use `--video --slides N-M`, and run long builds in the background.
- If `--video` fails with a connection error, the TTS/avatar service is down or `TALKDECK_*_URL` is wrong — report that rather than retrying or removing the voice/avatar.
- To see the result, build and open `output/slides.html` (the browser tool can open it); for the PDF, check page count equals slide count.
- Don't edit `output/`, `.cache.json`, or the installed package (`src/`, `template/`) just to make a deck look different — use a deck-local `themes/*.css` (it adds to or overrides the built-in theme) or `<style scoped>`.
- Marp directive reference: https://marpit.marp.app/directives
