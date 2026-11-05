# Running the talkdeck backends without the fleet

The deck's `--video` needs two services: a **TTS** (voice-overs) and a
**talking-head** (avatars). This folder builds them as two standalone images —
the official **Qwen3-TTS** and **Ditto** models behind small HTTP servers the
deck speaks natively — so you do not need the fleet (the door, the
orchestrator, the on-demand load/unload).

```
talkdeck make my-talk --video
    ├─ voice-overs  →  TALKDECK_TTS_URL    →  talkdeck/tts     (Qwen3-TTS)
    └─ avatars      →  TALKDECK_AVATAR_URL →  talkdeck/avatar  (Ditto)
```

## What is in the images

| Image | Contents | Port |
|---|---|---|
| `talkdeck/tts` | the official `qwen-tts` (PyPI) + a ~200-line OpenAI-compatible server (`/v1/audio/speech`, `/v1/audio/voices`, `/v1/models`) | 8081 |
| `talkdeck/avatar` | the official `ditto-talkinghead` (pinned commit) + a ~270-line task-API server (`/v1/video/generate`, `/v1/video/query`, `GET /v1/video/<id>`) | 8082 |

Each is built in two variants, from one Dockerfile per service (the `BASE` build-arg):

- **`cuda`** — the official `pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime` base (NVIDIA).
- **`rocm`** — the `rocm/pytorch` base.

The model **weights are not baked into the images** (a ~10 GB image is a poor
pull): they live in named volumes and are downloaded on the first start.

## 1. Build the images

Each service lives in its own directory (`tts/`, `avatar/`) with its own
`Dockerfile`; the compose files at the top build and run both.

```bash
cd deploy

docker compose -f docker-compose.cuda.yml build           # or docker-compose.rocm.yml
docker compose -f docker-compose.cuda.yml build tts       # one service only
```

## 2. Model weights (downloaded on the first start)

Nothing to seed by hand. On its first start each container downloads its weights
from Hugging Face into a named volume and loads them from there; later starts
are offline (a `.complete` marker in the volume skips the download):

| Volume | Mounted at | Downloaded on first start |
|---|---|---|
| `tts_models` | `/models` | `Qwen/Qwen3-TTS-12Hz-1.7B-Base` and `-VoiceDesign` (~8.5 GB) |
| `avatar_models` | `/opt/ditto/checkpoints` | the `ditto_pytorch/` and `ditto_cfg/` subsets of `digital-avatar/ditto-talkinghead` (~2 GB; the PyTorch path, not TensorRT) |

`/health` answers `503` with `{"status": "downloading <repo>"}` during the
download, then `loading`, then `200`. Set `HF_TOKEN` in the environment of
`docker compose up` if a repository needs a login. A failed download exits the
container and `restart: unless-stopped` retries it (the download resumes).

Already have the weights on disk? Copy them into the volume once, or bind-mount
the folders instead of the named volumes in the compose file (the layout is
`<dir>/Qwen3-TTS-12Hz-1.7B-Base`, `<dir>/Qwen3-TTS-12Hz-1.7B-VoiceDesign` for TTS
and `<dir>/ditto_pytorch`, `<dir>/ditto_cfg` for the avatar) and set
`AUTO_DOWNLOAD=0` to skip the download check. The layouts match the image's env vars
(`QWEN_BASE_MODEL=/models/Qwen3-TTS-12Hz-1.7B-Base`,
`DITTO_DATA_ROOT=/opt/ditto/checkpoints/ditto_pytorch`).

## 3. Run the services

One compose file per GPU vendor starts both services (`cuda` for NVIDIA,
`rocm` for AMD); name a service (`tts` or `avatar`) to start just one:

```bash
docker compose -f docker-compose.cuda.yml up -d          # both, NVIDIA
docker compose -f docker-compose.rocm.yml up -d tts      # TTS only, AMD
```

**Podman** works with the same files (`podman-compose` or `podman compose`).

**NVIDIA needs CDI** (the Container Device Interface) on both podman and docker:
the CUDA compose file asks for `nvidia.com/gpu=all`. One-time host setup: install
`nvidia-container-toolkit`, then

```bash
sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml    # rerun after a driver update
```

CDI needs docker 28.3 or newer (older docker has to be upgraded or have CDI
enabled). The AMD file passes `/dev/kfd` and `/dev/dri` directly and needs no setup.

Both containers load their models in the background (1–2 min, plus the download on the very first start) and answer
`/health` with `503` until they are ready (the first start also downloads the weights, see section 2). A single GPU can host both, but the
two 1.7B TTS models + Ditto peak at ~10 GB VRAM together — on a smaller card,
run one container, or set `QWEN_LOAD=base` / `QWEN_LOAD=voicedesign` in the
TTS container to load only one of the two TTS models.

## API (the same as the fleet door)

The two services speak the paths and task contract of the fleet door, split over
two ports, so any client written for the fleet works against them:

| Service | Endpoints |
|---|---|
| `tts` (8081) | `POST /v1/audio/speech` (`instructions` → voice design, else the base talker; optional `voice`, `language`/`lang`, `seed`, `temperature`, `top_k`, `top_p`, `repetition_penalty`; `wav` only), `POST /v1/audio/voices`, `GET /v1/audio/voices`, `DELETE /v1/audio/voices/<name>`, `GET /v1/models`, `GET /health` |
| `avatar` (8082) | `POST /v1/video/generate` (multipart `source` + `audio`, optional `format` mp4/mov/mkv, `size` 2–1920) → `task_id`, `POST /v1/video/query` → `[{status, result}]` (0 running, 1 done, 2 failed), `GET /v1/video/<task_id>`, `GET /v1/models`, `GET /health` |

Set `API_KEY` in the environment of `docker compose up` to require
`Authorization: Bearer <API_KEY>` on everything but `/health` and `/v1/models`
(the deck sends `TALKDECK_TTS_KEY` / `TALKDECK_AVATAR_KEY`). Finished videos stay
downloadable for 24 h (`AVATAR_RETENTION_S`) and survive a restart (the
`avatar_tasks` volume). The voice list and delete bodies are this server's own
shape (`{"voices": [...]}`); the deck does not use them.

## 4. Point the deck at them

```bash
export TALKDECK_TTS_URL=http://127.0.0.1:8081/v1/audio
export TALKDECK_AVATAR_URL=http://127.0.0.1:8082/v1/video
talkdeck make my-talk --video
```

(`talkdeck` installed from GitHub: `npm install -g github:meefik/talkdeck`.)

## 5. Verify

```bash
curl -s http://127.0.0.1:8081/health   # TTS: 503 while loading, 200 when ready
curl -s http://127.0.0.1:8082/health   # avatar: same
docker compose -f docker-compose.<cuda|rocm>.yml logs -f tts avatar    # "models loaded in N s" once ready
```

The first avatar after an idle gap is slow (the model cold-starts); the rest
run at ~5× realtime, one job at a time.

## How the two servers map to the deck

**TTS** (`tts/server.py`) — the deck's `tts.js` speaks an OpenAI-compatible
API; the server wraps the official `qwen_tts` package:

| Deck request | Official API |
|---|---|
| `POST /v1/audio/voices` `{name, wav_b64, ref_text}` | `create_voice_clone_prompt(...)` (a reusable clone prompt) |
| `POST /v1/audio/speech` `model: qwen-tts`, `voice: <name>` | `generate_voice_clone(text, voice_clone_prompt=...)` |
| `POST /v1/audio/speech` `model: qwen-tts-voicedesign`, `instructions: ...` | `generate_voice_design(text, instruct=...)` |
| `POST /v1/audio/speech` `model: qwen-tts`, no `voice` | the default voice (a neutral `generate_voice_design`) |

**Avatar** (`avatar/server.py`) — the deck's `avatar.js` speaks an async task
API; the server wraps the official `StreamSDK` (the same per-job pipeline as
Ditto's `inference.py::run`): `POST /v1/video/generate` (multipart `source` + `audio`)
→ `task_id`; `POST /v1/video/query` → `status` 0/1/2; `GET /v1/video/<task_id>` → the mp4.

## Notes

- **Verification:** the images are built from the official bases. The ROCm
  variant (10.1.0 base) was verified on an AMD Radeon 7600 XT (gfx11002) on
  2026-11-06: both services ran a real job end-to-end (a TTS voice clone +
  syntheses; a Ditto talking-head render) with no CPU busy-spin (the 10.1.0
  base carries the upstream `AsyncEventsLoop` fix, so no hsa_fix preload is
  needed), and the CUDA variant has not been run on NVIDIA. Each Dockerfile
  fails the build if a pip dependency replaces the base image's torch with a
  wheel of the other flavour. Check the `/health` endpoints (section 5) on
  your own machine.
- **Healthchecks and restarts:** each service has a `/health` healthcheck (30 min
  start period, for the first download) and `restart: unless-stopped`. A load
  failure (a bad download, out-of-memory) exits the container and the restart
  policy retries with backoff; read `logs` to see why.
- **Weights update:** remove the volume (`docker volume rm deploy_tts_models`,
  `deploy_avatar_models`; the prefix is the compose project, the folder name by default) and start again; the weights re-download — no image rebuild needed.
- **Bumping a model:** the Dockerfiles pin the Ditto commit (`DITTO_COMMIT`)
  and the `qwen-tts` version; bump deliberately, then re-verify.
- The fleet remains the option for multi-service, on-demand-load hosts; this
  is the "one machine, one deck" path.
