#!/usr/bin/env python3
"""Ditto talking-head task server (the deck's TALKDECK_AVATAR_URL backend).

Loads the official Ditto StreamSDK and serves the async task API the deck's
avatar.js speaks:

    POST /v1/video/generate   multipart (source, audio, format, size) -> {task_id}
    POST /v1/video/query      {"task_id_list": [..]} -> [{status, result}]
    GET  /v1/video/<task_id>                         -> the generated video
    GET  /v1/models                                  -> the served model ids
    GET  /health                                     -> 200 when the models are loaded

The same paths and task contract as the fleet door's talkinghead: `status` is 0
(running, `result` null), 1 (done, `result` = a JSON string {"file":
"/v1/video/<task_id>"}) or 2 (failed, `result` = a JSON string {"error": ...});
an unknown task id is status 2. One job at a time (Ditto renders one head at a
time). A settled task is written to <workdir>/<task_id>/status.json, so query and
the download survive a restart, and the task dir is deleted after
AVATAR_RETENTION_S (24 h). If API_KEY is set, every route but /health and
/v1/models needs `Authorization: Bearer <API_KEY>`. The models load from a local
path. On the first start a missing checkpoint set (the PyTorch subset) is
downloaded from Hugging Face into the /opt/ditto/checkpoints volume, so later
starts are offline; set AUTO_DOWNLOAD=0 to skip that and seed the volume
yourself. HF_TOKEN is used if set.
"""

import hmac
import json
import math
import os
import re
import shutil
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
PORT = int(os.environ.get("PORT", "8082"))
API_KEY = os.environ.get("API_KEY", "").strip()
AUTO_DOWNLOAD = os.environ.get("AUTO_DOWNLOAD", "1") != "0"
DITTO_REPO = os.environ.get("DITTO_REPO", "digital-avatar/ditto-talkinghead")
CHECKPOINTS = os.environ.get("DITTO_CHECKPOINTS", "/opt/ditto/checkpoints")
RETENTION_S = int(os.environ.get("AVATAR_RETENTION_S", "86400"))

# Output containers that take the engine's h264 + aac mux.
_FORMATS = frozenset({"mp4", "mov", "mkv"})
_MIME = {"mp4": "video/mp4", "mov": "video/quicktime", "mkv": "video/x-matroska"}
_TASK_ID = re.compile(r"[0-9a-f]{8,64}")

_sdk = None
_loaded = threading.Event()
_job_lock = threading.Lock()
_tasks = {}  # task_id -> {"status": int, "result": str | None, "fmt": str}
_tasks_lock = threading.Lock()
_workdir = os.environ.get("AVATAR_WORKDIR", "/srv/avatar")


_stage = "loading"


def _ensure_models():
    """Download the PyTorch checkpoints + configs once; the .complete marker makes later starts offline."""
    global _stage
    marker = os.path.join(CHECKPOINTS, ".complete")
    if not AUTO_DOWNLOAD or os.path.exists(marker):
        return
    from huggingface_hub import snapshot_download

    _stage = f"downloading {DITTO_REPO}"
    print(f"[avatar] downloading {DITTO_REPO} -> {CHECKPOINTS} (first start only) …", flush=True)
    snapshot_download(
        repo_id=DITTO_REPO, local_dir=CHECKPOINTS, allow_patterns=["ditto_pytorch/*", "ditto_cfg/*"]
    )
    open(marker, "w").close()
    _stage = "loading"


def _load():
    global _sdk
    t0 = time.time()
    print(f"[avatar] loading Ditto (data_root={DATA_ROOT}) …", flush=True)
    try:
        _ensure_models()
        _sdk = StreamSDK(CFG_PKL, DATA_ROOT)
    except BaseException:
        traceback.print_exc()
        print("[avatar] model load failed (a download error: check the network / HF_TOKEN); exiting, a restart re-attempts it", flush=True)
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


def _task_dir(task_id):
    return os.path.join(_workdir, task_id)


def _set_task(task_id, status, result):
    """Record a task's state; a settled one is also written to the volume."""
    with _tasks_lock:
        t = {"status": status, "result": result, "fmt": _tasks.get(task_id, {}).get("fmt", "mp4")}
        _tasks[task_id] = t
    if status == 0:
        return
    try:
        tmp = os.path.join(_task_dir(task_id), "status.json.tmp")
        with open(tmp, "w") as f:
            json.dump(t, f)
        os.replace(tmp, os.path.join(_task_dir(task_id), "status.json"))
    except OSError as e:
        print(f"[avatar] could not persist task {task_id}: {e!r}", flush=True)


def _task_state(task_id):
    with _tasks_lock:
        t = _tasks.get(task_id)
    if t is not None:
        return t
    tdir = _task_dir(task_id)
    if os.path.isdir(tdir):
        try:
            with open(os.path.join(tdir, "status.json")) as f:
                return json.load(f)
        except (OSError, ValueError):
            # A dir with no settled status and no memory of it: the server restarted mid-job.
            return {"status": 2, "result": json.dumps({"error": "task interrupted (the server restarted mid-job)"}), "fmt": "mp4"}
    return {"status": 2, "result": json.dumps({"error": "unknown task_id"}), "fmt": "mp4"}


def _worker(task_id, source, audio, out, size):
    try:
        with _job_lock:
            _run_job(source, audio, out, size=size)
        _set_task(task_id, 1, json.dumps({"file": f"/v1/video/{task_id}"}))
        print(f"[avatar] task {task_id} done", flush=True)
    except Exception as e:  # noqa: BLE001 — a crash must not kill the server
        _set_task(task_id, 2, json.dumps({"error": repr(e)}))
        print(f"[avatar] task {task_id} failed: {e!r}", flush=True)


def _sweep():
    """Delete task dirs older than the retention (a running job's dir is touched by its own writes)."""
    while True:
        time.sleep(600)
        cutoff = time.time() - RETENTION_S
        try:
            names = os.listdir(_workdir)
        except OSError:
            continue
        for name in names:
            if not _TASK_ID.fullmatch(name):
                continue
            with _tasks_lock:
                running = _tasks.get(name, {}).get("status") == 0
            tdir = _task_dir(name)
            try:
                if not running and os.stat(tdir).st_mtime < cutoff:
                    shutil.rmtree(tdir, ignore_errors=True)
                    with _tasks_lock:
                        _tasks.pop(name, None)
            except OSError:
                pass


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

    def _auth_ok(self):
        if not API_KEY:
            return True
        return hmac.compare_digest(
            self.headers.get("Authorization", "").encode(), f"Bearer {API_KEY}".encode()
        )

    def do_GET(self):
        p = self.path.split("?", 1)[0].rstrip("/")
        if p in ("", "/health"):
            if _loaded.is_set():
                self._json(200, {"status": "ok", "engine": "ready"})
            else:
                self._json(503, {"status": _stage})
            return
        if p == "/v1/models":
            self._json(200, {"object": "list", "data": [{"id": "ditto", "object": "model", "served_by": "avatar"}]})
            return
        if not self._auth_ok():
            self._json(401, {"error": "unauthorized"})
            return
        m = re.fullmatch(r"/v1/video/([0-9a-f]{8,64})", p)
        if m:
            task_id = m.group(1)
            t = _task_state(task_id)
            # Only a finished task's output is served, never a partial one.
            fpath = os.path.join(_task_dir(task_id), "out." + t.get("fmt", "mp4"))
            if t["status"] != 1 or not os.path.isfile(fpath):
                self._json(404, {"error": "file not found"})
                return
            with open(fpath, "rb") as f:
                self._bytes(200, f.read(), _MIME.get(fpath.rsplit(".", 1)[-1], "application/octet-stream"))
            return
        self._json(404, {"error": f"no such endpoint: GET {p}"})

    def do_POST(self):
        if not self._auth_ok():
            self._json(401, {"error": "unauthorized"})
            return
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b""
        p = self.path.split("?", 1)[0].rstrip("/")
        if not _loaded.wait(timeout=1800):
            self._json(503, {"error": "models are still loading"})
            return
        try:
            if p == "/v1/video/query":
                body = json.loads(raw or b"{}")
                ids = body.get("task_id_list", []) if isinstance(body, dict) else None
                if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
                    raise ValueError("task_id_list must be a list of task ids")
                out = []
                for i in ids:
                    t = _task_state(i) if _TASK_ID.fullmatch(i) else {"status": 2, "result": json.dumps({"error": "unknown task_id"})}
                    out.append({"status": t["status"], "result": t["result"]})
                self._json(200, out)
            elif p == "/v1/video/generate":
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
                tdir = _task_dir(task_id)
                os.makedirs(tdir, exist_ok=True)
                with open(os.path.join(tdir, "source"), "wb") as f:
                    f.write(parts["source"][1])
                with open(os.path.join(tdir, "audio"), "wb") as f:
                    f.write(parts["audio"][1])
                with _tasks_lock:
                    _tasks[task_id] = {"status": 0, "result": None, "fmt": fmt}
                threading.Thread(
                    target=_worker,
                    args=(task_id, os.path.join(tdir, "source"), os.path.join(tdir, "audio"), os.path.join(tdir, f"out.{fmt}"), size),
                    daemon=True,
                ).start()
                self._json(200, {"task_id": task_id, "status": "queued"})
            else:
                self._json(404, {"error": f"no such endpoint: POST {p}"})
        except ValueError as e:
            self._json(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001 — answer instead of dropping the connection
            traceback.print_exc()
            self._json(500, {"error": f"internal error: {e!r}"})

    def log_message(self, fmt, *args):
        print(f"[avatar] {self.command} {self.path}", flush=True)


def main():
    os.makedirs(_workdir, exist_ok=True)
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[avatar] listening :{PORT}; loading models in the background", flush=True)
    threading.Thread(target=_load, daemon=True).start()
    threading.Thread(target=_sweep, daemon=True).start()
    srv.serve_forever()


if __name__ == "__main__":
    main()
