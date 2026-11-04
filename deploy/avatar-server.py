#!/usr/bin/env python3
"""Ditto talking-head task server (the deck's DECK_AVATAR_URL backend).

Loads the official Ditto StreamSDK and serves the async task API the deck's
avatar.js speaks:

    POST /generate   multipart (source, audio, format, size) -> {task_id}
    POST /query      {"task_id_list": [..]} -> [{status, result}]
    GET  /v1/video/<task_id>                -> the generated video
    GET  /health                            -> 200 when the models are loaded

`status` is 0 (running), 1 (done, `result` = {"file": "/v1/video/<task_id>"}),
or 2 (failed). One job at a time (Ditto renders one head at a time). The models
load from a local path (seed the volume with `huggingface-cli download`).
"""

import io
import json
import math
import os
import re
import subprocess
import sys
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import filetype
import librosa

sys.path.insert(0, os.environ.get("DITTO_DIR", "/opt/ditto"))
from stream_pipeline_offline import StreamSDK  # noqa: E402

# Ditto renders the face at 512 internally: the sweet spot (~40% faster than
# 1024, 256 buys nothing).
DEFAULT_SIZE = int(os.environ.get("AVATAR_DEFAULT_SIZE", "512"))
DATA_ROOT = os.environ.get("DITTO_DATA_ROOT", "/opt/ditto/checkpoints/ditto_pytorch")
CFG_PKL = os.environ.get("DITTO_CFG", "/opt/ditto/checkpoints/ditto_cfg/v0.4_hubert_cfg_pytorch.pkl")
PORT = int(os.environ.get("PORT", "8020"))

# Output containers that take the engine's h264 + aac mux.
_FORMATS = frozenset({"mp4", "mov", "mkv"})
_MIME = {"mp4": "video/mp4", "mov": "video/quicktime", "mkv": "video/x-matroska"}
_TASK_ID = re.compile(r"[0-9a-f]{8,64}")

_sdk = None
_loaded = threading.Event()
_job_lock = threading.Lock()
_tasks = {}  # task_id -> {"status": int, "result": dict}
_tasks_lock = threading.Lock()
_workdir = os.environ.get("AVATAR_WORKDIR", "/tmp/avatar")


def _load():
    global _sdk
    t0 = time.time()
    print(f"[avatar] loading Ditto (data_root={DATA_ROOT}) …", flush=True)
    try:
        _sdk = StreamSDK(CFG_PKL, DATA_ROOT)
    except BaseException:
        traceback.print_exc()
        print("[avatar] model load failed; exiting (a restart re-attempts the load)", flush=True)
        os._exit(1)
    _loaded.set()
    print(f"[avatar] models loaded in {time.time() - t0:.0f} s", flush=True)


def _normalize_source(source_path, size, out_path):
    """Center-crop to a square and resize, so the output is exactly size x size."""
    if not filetype.is_image(source_path):
        raise ValueError("source must be an image (video sources are not supported)")
    img = cv2.imread(source_path, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"could not read source image: {source_path}")
    h, w = img.shape[:2]
    s = min(h, w)
    x0, y0 = (w - s) // 2, (h - s) // 2
    img = img[y0 : y0 + s, x0 : x0 + s]
    img = cv2.resize(img, (size, size), interpolation=cv2.INTER_AREA if s > size else cv2.INTER_LINEAR)
    if not cv2.imwrite(out_path, img):
        raise ValueError("could not write the normalized source")
    return out_path


def _run_job(source_path, audio_path, output_path, size=DEFAULT_SIZE):
    """Caller holds _job_lock. Mirrors the fleet engine's per-job pipeline."""
    if _sdk is None:
        raise RuntimeError("models not loaded")
    t0 = time.time()
    norm = os.path.join(os.path.dirname(source_path), "source-norm.png")
    _normalize_source(source_path, size, norm)
    # librosa/soundfile cannot read mp3, so let ffmpeg decode any upload first.
    vo_wav = output_path + ".vo.wav"
    r = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-i", audio_path, "-ar", "16000", "-ac", "1", vo_wav],
        capture_output=True, text=True, check=False,
    )
    if r.returncode != 0:
        raise RuntimeError(f"audio decode failed: {r.stderr.strip()[:200]}")
    audio, sr = librosa.core.load(vo_wav, sr=16000)
    num_f = math.ceil(len(audio) / 16000 * 25)
    _sdk.setup(norm, output_path)
    _sdk.setup_Nd(N_d=num_f)
    _sdk.audio2motion_queue.put(_sdk.wav2feat.wav2feat(audio))
    _sdk.close()
    # inference.py's exact mux: the SDK's h264 video + the (re-encoded) audio.
    tmp = _sdk.tmp_output_path
    cmd = ["ffmpeg", "-loglevel", "error", "-y", "-i", tmp, "-i", audio_path,
           "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", output_path]
    r = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg mux failed: {r.stderr.strip()[:200]}")
    return {"seconds": round(len(audio) / sr, 3), "frames": num_f, "wall_s": round(time.time() - t0, 1)}


def _worker(task_id, source, audio, out, size):
    # do_POST seeds _tasks[task_id] with {"status": 0, "result": {"fmt": ...}};
    # preserve that result (the download reads the format from it) and only
    # update the status here.
    def _set(status, result):
        with _tasks_lock:
            prev = _tasks.get(task_id) or {}
            merged = dict(prev.get("result") or {})
            merged.update(result)
            _tasks[task_id] = {"status": status, "result": merged}

    _set(0, {})
    try:
        with _job_lock:
            _run_job(source, audio, out, size=size)
        _set(1, {"file": f"/v1/video/{task_id}"})
        print(f"[avatar] task {task_id} done", flush=True)
    except Exception as e:  # noqa: BLE001 — a crash must not kill the server
        _set(2, {"error": repr(e)})
        print(f"[avatar] task {task_id} failed: {e!r}", flush=True)


def _parse_multipart(body, content_type):
    """-> {name: (filename, data)}. Adapted from the fleet door's helper."""
    m = re.search(r'boundary=(?:"([^"]+)"|([^;]+))', content_type or "")
    if not m:
        return {}
    delim = b"--" + (m.group(1) or m.group(2).strip()).encode("latin-1")
    out = {}
    pos = body.find(delim)
    while pos != -1:
        start = pos + len(delim)
        nxt = body.find(delim, start)
        end = len(body) if nxt == -1 else nxt
        pos = nxt
        head_end = body.find(b"\r\n\r\n", start, end)
        if head_end == -1:
            continue
        data_start = head_end + 4
        if end - data_start >= 2 and body[end - 2 : end] == b"\r\n":
            end -= 2
        head_s = body[start:head_end].decode("latin-1")
        data = body[data_start:end]
        name = re.search(r'(?:^|[;\s])name="([^"]*)"', head_s)
        fname = re.search(r'filename="([^"]*)"', head_s)
        if name:
            fn = fname.group(1).encode("latin-1").decode("utf-8", "replace") if fname else ""
            out[name.group(1)] = (fn, data)
    return out


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _bytes(self, code, data, ctype):
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
            return
        m = re.fullmatch(r"/v1/video/([0-9a-f]{8,64})", p)
        if m:
            task_id = m.group(1)
            with _tasks_lock:
                t = _tasks.get(task_id)
            if not t or t["status"] != 1:
                self._json(404, {"error": "file not found (the task is not done)"})
                return
            fpath = os.path.join(_workdir, task_id, "out." + (t["result"].get("fmt", "mp4")))
            if not os.path.isfile(fpath):
                self._json(404, {"error": "file not found"})
                return
            with open(fpath, "rb") as f:
                self._bytes(200, f.read(), _MIME.get(fpath.rsplit(".", 1)[-1], "application/octet-stream"))
            return
        self._json(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b""
        p = self.path.lstrip("/")
        if not _loaded.wait(timeout=600):
            self._json(503, {"error": "models are still loading"})
            return
        try:
            if p == "query":
                body = json.loads(raw or b"{}")
                ids = body.get("task_id_list", [])
                if not isinstance(ids, list):
                    raise ValueError("task_id_list must be a list")
                out = []
                with _tasks_lock:
                    for i in ids:
                        t = _tasks.get(i) or {"status": 2, "result": {"error": "unknown task_id"}}
                        out.append({"status": t["status"], "result": json.dumps(t["result"]) if t["result"] is not None else None})
                self._json(200, out)
            elif p == "generate":
                parts = _parse_multipart(raw, self.headers.get("Content-Type", ""))
                if "source" not in parts or "audio" not in parts:
                    raise ValueError("multipart needs source + audio")
                fmt = parts.get("format", ("", b"mp4"))[1].decode("latin-1").strip().lower() or "mp4"
                if fmt not in _FORMATS:
                    raise ValueError(f"format must be one of {sorted(_FORMATS)}")
                size = int(parts.get("size", ("", b"512"))[1].decode("latin-1").strip() or "512")
                if not (2 <= size <= 1920):
                    raise ValueError("size must be 2..1920")
                task_id = uuid.uuid4().hex
                tdir = os.path.join(_workdir, task_id)
                os.makedirs(tdir, exist_ok=True)
                with open(os.path.join(tdir, "source"), "wb") as f:
                    f.write(parts["source"][1])
                with open(os.path.join(tdir, "audio"), "wb") as f:
                    f.write(parts["audio"][1])
                # Remember the format so the download knows the extension.
                with _tasks_lock:
                    _tasks[task_id] = {"status": 0, "result": {"fmt": fmt}}
                threading.Thread(
                    target=_worker,
                    args=(task_id, os.path.join(tdir, "source"), os.path.join(tdir, "audio"), os.path.join(tdir, f"out.{fmt}"), size),
                    daemon=True,
                ).start()
                self._json(200, {"task_id": task_id, "status": "queued"})
            else:
                self._json(404, {"error": "not found"})
        except ValueError as e:
            self._json(400, {"error": str(e)})

    def log_message(self, fmt, *args):
        print(f"[avatar] {self.command} {self.path}", flush=True)


def main():
    os.makedirs(_workdir, exist_ok=True)
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[avatar] listening :{PORT}; loading models in the background", flush=True)
    threading.Thread(target=_load, daemon=True).start()
    srv.serve_forever()


if __name__ == "__main__":
    main()
