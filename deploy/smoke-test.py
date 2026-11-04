#!/usr/bin/env python3
"""Smoke test for the deck backend containers (run inside a container, or
against a running one). Verifies the GPU is visible and the server answers.

Usage (inside the container):
    python3 /opt/smoke-test.py
Against a running one:
    SMOKE_TTS_URL=http://127.0.0.1:8008 SMOKE_AVATAR_URL=http://127.0.0.1:8020 python3 smoke-test.py
"""

import os
import sys
import time
import urllib.request

TTS_URL = os.environ.get("SMOKE_TTS_URL", "http://127.0.0.1:8008")
AVATAR_URL = os.environ.get("SMOKE_AVATAR_URL", "http://127.0.0.1:8020")


def get(url):
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return r.status, r.read().decode("latin-1", "replace")
    except Exception as e:
        return -1, repr(e)


def main():
    ok = True
    # 1. The GPU, if any (a CPU-only box is a valid dev box, not a failure).
    try:
        import torch

        print(f"torch {torch.__version__}; cuda available: {torch.cuda.is_available()}")
        if torch.cuda.is_available():
            print(f"  device: {torch.cuda.get_device_name(0)}")
            x = torch.randn(1024, 1024, device="cuda") @ torch.randn(1024, 1024, device="cuda")
            torch.cuda.synchronize()
            print("  a matmul ran on the GPU")
        else:
            print("  (no GPU visible; the TTS can still run on CPU, slowly)")
    except Exception as e:
        print(f"  torch check failed: {e!r}")
        ok = False
    # 2. The TTS server answers /health.
    st, body = get(f"{TTS_URL}/health")
    print(f"TTS {TTS_URL}/health -> {st} {body[:120]}")
    if st == 503:
        print("  (the models are still loading; wait a minute and retry)")
        ok = False
    elif st != 200:
        ok = False
    # 3. The avatar server answers /health.
    st, body = get(f"{AVATAR_URL}/health")
    print(f"avatar {AVATAR_URL}/health -> {st} {body[:120]}")
    if st == 503:
        print("  (the models are still loading; wait a minute and retry)")
        ok = False
    elif st != 200:
        ok = False
    print("SMOKE:", "OK" if ok else "FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
