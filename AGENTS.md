# AGENTS.md

Talkdeck: a small Node CLI (ESM, Node ≥ 22.12) that turns Markdown slides (Marp Core +
extra containers) into HTML, PDF and a narrated MP4. `README.md` is the user
documentation (usage, front matter, cheatsheet); `SKILL.md` is the guide for agents
*using* the CLI to build decks. This file is for working on the repo itself.

## Layout

- `src/cli.js` — entry point; commands `init`, `make`, `voice`, option parsing, env handling
- `src/config.js` — front matter settings and validation
- `src/render.js` — Markdown → slides, HTML page, assets; `src/runtime/` is the player JS/CSS inlined into `slides.html`
- `src/pdf.js`, `src/browser.js` — PDF via headless Chrome (puppeteer-core, no bundled browser)
- `src/notes.js`, `src/tts.js`, `src/voices.js`, `src/avatar.js`, `src/video.js`, `src/cache.js`, `src/color.js`, `src/helpers.js` — voice-over / avatar / video pipeline and the `.cache.json` manifest
- `template/` — bundled default deck, themes, avatars, voice samples (always available to every deck)
- `deploy/` — optional Python TTS and avatar servers + container images, one compose file per GPU vendor (CUDA/ROCm); see `deploy/README.md`

## Commands

```bash
npm install
npm run talkdeck -- make                 # build template/ → ./output/slides.html
npm run talkdeck -- make --pdf --video   # needs Chrome/Chromium (CHROMIUM_PATH) and ffmpeg; video also needs the TTS/avatar services
```

There is no test suite or linter. Verify a change by building the template deck
(`make`, plus `--pdf` when touching rendering/CSS) and looking at the output. The
video pipeline needs running services, so say so if you could not exercise it.
`output/` and `node_modules/` are git-ignored.

## Conventions

- Plain JavaScript ES modules, no build step, no TypeScript. Style per `.editorconfig`: 2-space indent, LF, final newline.
- Keep the code simple and concise, with no unnecessary abstractions.
- Comments explain why (quirks, pin reasons, fail-closed rules, non-obvious ordering), never what. No banners or change history. If code needs a comment to explain what it does, simplify the code.
- Keep dependencies minimal (currently marp-core, js-yaml, markdown-it-container, puppeteer-core); don't add one for something small.
- Service addresses and keys come from the environment (`TALKDECK_TTS_URL`, `TALKDECK_TTS_KEY`, `TALKDECK_AVATAR_URL`, `TALKDECK_AVATAR_KEY`, `CHROMIUM_PATH`), never from the deck.
- The TTS and avatar services are spoken to over OpenAI-compatible HTTP APIs; `deploy/*/server.py` must stay compatible with what `src/tts.js` / `src/avatar.js` send.
- Generated files are cached by content (`.cache.json`); when changing what goes into a generated file, make sure the cache key reflects it.
- Fully qualify container base images (podman has no default registry).

## Keeping docs in sync

When you change CLI options, front matter settings, output files, containers/syntax
or the file list, update `README.md` (usage, output table, cheatsheet, Files) and
`SKILL.md` in the same change. Keep line counts and file lists in docs accurate.

## Git

Commit messages are short, lowercase-prefixed by area (`deploy:`, `notes:`, `compose:`, `docs:`). Don't commit unless asked.
