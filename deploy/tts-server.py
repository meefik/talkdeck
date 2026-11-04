#!/usr/bin/env python3
"""Qwen3-TTS OpenAI-compatible server (the deck's DECK_TTS_URL backend).

Loads the official Qwen3-TTS models and serves the routes the deck's tts.js
speaks:

    POST /v1/audio/voices   {name, wav_b64, ref_text?}        -> register a clone
    POST /v1/audio/speech   {model, input, voice?, instructions?, ...} -> wav
    GET  /health            -> 200 when the models are loaded, 503 while loading

`model` is "qwen-tts" (a registered clone, or the default voice) or
"qwen-tts-voicedesign" (a voice designed from `instructions`). A `voice` name
is a clone registered via /v1/audio/voices; `instructions` is a free-text voice
description; neither is present = the default voice (a neutral design).

The models load from local paths (seed the volume with `huggingface-cli
download`); QWEN_BASE_MODEL / QWEN_VD_MODEL point at them. Two 1.7B models are
loaded by default (~7 GB VRAM); set QWEN_LOAD to run one of them on a small card.
"""

import base64
import binascii
import io
import json
import os
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import soundfile as sf
import torch

PORT = int(os.environ.get("PORT", "8008"))
# The device: an explicit DEVICE wins; otherwise the first CUDA device, else CPU.
_req_device = os.environ.get("DEVICE", "")
if _req_device:
    DEVICE = _req_device
elif torch.cuda.is_available():
    DEVICE = "cuda:0"
else:
    DEVICE = "cpu"
    print("[tts] no CUDA device visible; running on CPU (slow)", flush=True)
DTYPE = torch.bfloat16
ATTN = os.environ.get("ATTN", "sdpa")  # flash_attention_2 saves VRAM but needs a build
BASE_MODEL = os.environ.get("QWEN_BASE_MODEL", "/models/Qwen3-TTS-12Hz-1.7B-Base")
VD_MODEL = os.environ.get("QWEN_VD_MODEL", "/models/Qwen3-TTS-12Hz-1.7B-VoiceDesign")
DEFAULT_INSTRUCT = os.environ.get("QWEN_DEFAULT_INSTRUCT", "A clear, calm narrator.")
# Comma list of models to load: "base,voicedesign" (default) or one of them.
LOAD = [x.strip() for x in os.environ.get("QWEN_LOAD", "base,voicedesign").split(",") if x.strip()]

from qwen_tts import Qwen3TTSModel  # noqa: E402  (after the env is read)

_lock = threading.Lock()
_loaded = threading.Event()
_base = None
_vd = None
_clones = {}  # name -> voice_clone_prompt


def _load():
    global _base, _vd
    t0 = time.time()
    print(f"[tts] loading models on {DEVICE} (base={BASE_MODEL}, vd={VD_MODEL}) …", flush=True)
    try:
        if "base" in LOAD:
            _base = Qwen3TTSModel.from_pretrained(
                BASE_MODEL, device_map=DEVICE, dtype=DTYPE, attn_implementation=ATTN
            )
            print(f"[tts] base loaded in {time.time() - t0:.0f} s", flush=True)
        if "voicedesign" in LOAD:
            t1 = time.time()
            _vd = Qwen3TTSModel.from_pretrained(
                VD_MODEL, device_map=DEVICE, dtype=DTYPE, attn_implementation=ATTN
            )
            print(f"[tts] voicedesign loaded in {time.time() - t1:.0f} s", flush=True)
    except BaseException:
        traceback.print_exc()
        print(
            "[tts] model load failed. If it is a CUDA out-of-memory error, the two 1.7B "
            "models do not fit this GPU at once: set QWEN_LOAD=base (clones only) or "
            "QWEN_LOAD=voicedesign (designed voices only) and retry.",
            flush=True,
        )
        os._exit(1)
    _loaded.set()
    print("[tts] ready", flush=True)


def _wav_bytes(wavs, sr):
    buf = io.BytesIO()
    sf.write(buf, np.asarray(wavs[0]), int(sr), format="WAV")
    return buf.getvalue()


def _ref_audio(wav_b64):
    """The official API only treats a bare base64 string as audio when it is
    longer than 256 chars (or has a `data:` prefix); a short one is read as a
    file path. A `data:audio/...;base64,` URL takes the documented base64 path
    at any length (the prefix is stripped before the decode), so normalize to it.
    A value that is not base64 (a URL or a path) passes through unchanged."""
    if wav_b64.startswith("data:"):
        return wav_b64
    try:
        base64.b64decode("".join(wav_b64.split()), validate=True)
    except (binascii.Error, ValueError):
        return wav_b64
    return f"data:audio/wav;base64,{wav_b64}"


def _register(body):
    name = body.get("name")
    wav_b64 = body.get("wav_b64")
    if not name or not wav_b64:
        raise ValueError("name and wav_b64 are required")
    if _base is None:
        raise RuntimeError("the base model is not loaded (set QWEN_LOAD=base)")
    ref_text = body.get("ref_text")
    # Without a transcript, fall back to the speaker embedding only
    # (x_vector_only_mode), which needs no ref_text.
    prompt = _base.create_voice_clone_prompt(
        ref_audio=_ref_audio(wav_b64), ref_text=ref_text, x_vector_only_mode=ref_text is None
    )
    # do_POST holds _lock around _register, so this assignment is already
    # serialized (a non-reentrant lock must not be re-acquired here).
    _clones[name] = prompt
    print(f"[tts] registered clone {name!r}", flush=True)
    return {"name": name, "status": "ok"}


def _synth(body):
    model = body.get("model", "qwen-tts")
    text = body.get("input")
    if not text:
        raise ValueError("input is required")
    language = body.get("language", "Auto")
    if model == "qwen-tts-voicedesign":
        if _vd is None:
            raise RuntimeError("the voicedesign model is not loaded (set QWEN_LOAD=voicedesign)")
        instruct = body.get("instructions") or DEFAULT_INSTRUCT
        wavs, sr = _vd.generate_voice_design(text=text, language=language, instruct=instruct)
    else:  # qwen-tts: a registered clone, or the default voice
        voice = body.get("voice")
        if voice:
            if _base is None:
                raise RuntimeError("the base model is not loaded (set QWEN_LOAD=base)")
            if voice not in _clones:
                raise ValueError(f"unknown voice {voice!r} (register it with POST /v1/audio/voices)")
            wavs, sr = _base.generate_voice_clone(
                text=text, language=language, voice_clone_prompt=_clones[voice]
            )
        else:
            # The default voice: a neutral design (the base model needs a reference).
            if _vd is None:
                raise RuntimeError(
                    "the default voice needs the voicedesign model (set QWEN_LOAD=voicedesign)"
                )
            wavs, sr = _vd.generate_voice_design(text=text, language=language, instruct=DEFAULT_INSTRUCT)
    return _wav_bytes(wavs, sr)


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _bytes(self, code, data, ctype="audio/wav"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        p = self.path.rstrip("/")
        if p in ("", "/health"):
            if _loaded.is_set():
                self._json(200, {"status": "ok", "engine": "ready"})
            else:
                self._json(503, {"status": "loading"})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except ValueError:
            self._json(400, {"error": "body must be JSON"})
            return
        p = self.path.lstrip("/")
        # The models load in the background (1-2 min); a request may wait for them.
        if not _loaded.wait(timeout=600):
            self._json(503, {"error": "models are still loading"})
            return
        try:
            if p == "v1/audio/voices":
                with _lock:
                    self._json(200, _register(body))
            elif p == "v1/audio/speech":
                with _lock:
                    self._bytes(200, _synth(body))
            else:
                self._json(404, {"error": "not found"})
        except (ValueError, RuntimeError) as e:
            self._json(400, {"error": str(e)})

    def log_message(self, fmt, *args):
        print(f"[tts] {self.command} {self.path}", flush=True)


def main():
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[tts] listening :{PORT}; loading models in the background", flush=True)
    threading.Thread(target=_load, daemon=True).start()
    srv.serve_forever()


if __name__ == "__main__":
    main()
