# Running the deck backends without the fleet

The deck's `--video` needs two services: a **TTS** (voice-overs) and a
**talking-head** (avatars). This folder builds them as two standalone images —
the official **Qwen3-TTS** and **Ditto** models behind small HTTP servers the
deck speaks natively — so you do not need the fleet (the door, the
orchestrator, the on-demand load/unload).

```
deck make my-talk --video
    ├─ voice-overs  →  DECK_TTS_URL    →  deck-tts     (Qwen3-TTS)
    └─ avatars      →  DECK_AVATAR_URL →  deck-avatar  (Ditto)
```

## What is in the images

| Image | Contents | Port |
|---|---|---|
| `deck-tts` | the official `qwen-tts` (PyPI) + a ~200-line OpenAI-compatible server (`/v1/audio/speech`, `/v1/audio/voices`) | 8008 |
| `deck-avatar` | the official `ditto-talkinghead` (pinned commit) + a ~270-line task-API server (`/generate`, `/query`, `GET /v1/video/<id>`) | 8020 |

Each is built in two variants, from the same Dockerfile (`VARIANT` build-arg):

- **`cuda`** — the official `pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime` base (NVIDIA).
- **`rocm`** — the `rocm/pytorch` base + the `hsa_fix` (the ROCR 1.18 runtime + a 15-stub shim, the same fix the fleet uses for the torch 2.12 ROCm wheel).

The model **weights are not baked into the images** (a ~10 GB image is a poor
pull): they are mounted from `./models` and seeded once with `huggingface-cli`.

## 1. Build the images

```bash
cd projects/deck/deploy

# The ROCm variant COPYs the hsa_fix from a builder image; build it if missing:
(cd ../../../projects/fleet/build/hsa_fix && bash build.sh)   # -> mirafleet/hsa-fix-build

sh build.sh                # all four (podman; set DOCKER=docker or REGISTRY= for your tool)
```

## 2. Seed the model weights (one-time, ~10 GB)

```bash
mkdir -p models/qwen models/ditto
huggingface-cli download Qwen/Qwen3-TTS-12Hz-1.7B-Base        --local-dir models/qwen
huggingface-cli download Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign --local-dir models/qwen
huggingface-cli download digital-avatar/ditto-talkinghead     --local-dir models/ditto
```

The layouts match the image's env vars out of the box
(`QWEN_BASE_MODEL=/models/Qwen3-TTS-12Hz-1.7B-Base`,
`DITTO_DATA_ROOT=/opt/ditto/checkpoints/ditto_pytorch` — the PyTorch subset,
not the TensorRT one).

## 3. Run the services

**NVIDIA GPU:**

```bash
docker compose up -d
```

**AMD GPU (ROCm):**

```bash
docker compose -f docker-compose.rocm.yml up -d
```

Both containers load their models in the background (1–2 min) and answer
`/health` with `503` until they are ready. A single GPU can host both, but the
two 1.7B TTS models + Ditto peak at ~10 GB VRAM together — on a smaller card,
run one container, or set `QWEN_LOAD=base` / `QWEN_LOAD=voicedesign` in the
TTS container to load only one of the two TTS models.

## 4. Point the deck at them

```bash
export DECK_TTS_URL=http://127.0.0.1:8008/v1/audio
export DECK_AVATAR_URL=http://127.0.0.1:8020/v1/video
deck make my-talk --video
```

(`deck` installed from GitHub: `npm install -g github:meefik/deck`.)

## 5. Verify

```bash
python3 smoke-test.py                 # GPU visible + both /health endpoints answer
docker compose logs -f tts avatar    # "models loaded in N s" once ready
```

The first avatar after an idle gap is slow (the model cold-starts); the rest
run at ~5× realtime, one job at a time.

## How the two servers map to the deck

**TTS** (`tts-server.py`) — the deck's `tts.js` speaks an OpenAI-compatible
API; the server wraps the official `qwen_tts` package:

| Deck request | Official API |
|---|---|
| `POST /v1/audio/voices` `{name, wav_b64, ref_text}` | `create_voice_clone_prompt(...)` (a reusable clone prompt) |
| `POST /v1/audio/speech` `model: qwen-tts`, `voice: <name>` | `generate_voice_clone(text, voice_clone_prompt=...)` |
| `POST /v1/audio/speech` `model: qwen-tts-voicedesign`, `instructions: ...` | `generate_voice_design(text, instruct=...)` |
| `POST /v1/audio/speech` `model: qwen-tts`, no `voice` | the default voice (a neutral `generate_voice_design`) |

**Avatar** (`avatar-server.py`) — the deck's `avatar.js` speaks an async task
API; the server wraps the official `StreamSDK` (the same per-job pipeline as
Ditto's `inference.py::run`): `POST /generate` (multipart `source` + `audio`)
→ `task_id`; `POST /query` → `status` 0/1/2; `GET /v1/video/<task_id>` → the mp4.

## Notes

- **CUDA variant, verification:** the images are built from the official bases
  and the same pinned model commits the fleet uses; the ROCm variant is
  verified on this host's 7600 XT. The CUDA variant needs a run on an NVIDIA
  card for the final sign-off (or the `smoke-test.py` on your own machine).
- **Weights update:** re-run the `huggingface-cli download` with `--force`
  (or delete `models/` and re-seed) — no image rebuild needed.
- **Bumping a model:** the Dockerfiles pin the Ditto commit (`DITTO_COMMIT`)
  and the `qwen-tts` version; bump deliberately, then re-verify.
- The fleet remains the option for multi-service, on-demand-load hosts; this
  is the "one machine, one deck" path.
