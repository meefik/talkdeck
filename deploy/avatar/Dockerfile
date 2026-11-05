# talkdeck/avatar — Ditto (official model) behind the deck's async task API.
#
# Two variants, built from this one file by choosing the BASE image:
#
#   cuda  BASE=docker.io/pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime
#                 (the official NVIDIA PyTorch base, torch 2.5.1 — matches
#                  Ditto's environment.yaml; the common case for a non-fleet user)
#   rocm  BASE=docker.io/rocm/pytorch:rocm10.1.0_ubuntu24.04_py3.12_pytorch_release_2.12.0
#                 (the AMD ROCm PyTorch base; 10.1.0 carries the upstream
#                  AsyncEventsLoop fix, so no hsa_fix preload is needed)
#
# The model weights are NOT baked in: the server downloads them into the mounted
# /opt/ditto/checkpoints volume on the first start (see the README) and loads
# them from DITTO_DATA_ROOT / DITTO_CFG.

# The base image, chosen per variant (set in the compose files).
ARG BASE=docker.io/pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime
FROM ${BASE}

ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1

# System deps: git (the pinned clone), ffmpeg (audio decode + the video mux),
# the GL libs mediapipe needs (the base lacks them), gcc/g++ (the blend build).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
         git ffmpeg gcc g++ libegl1 libgl1 libgles2 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Remember which torch the base image ships (ROCm or CUDA build): a pip dependency
# must not replace it with a PyPI wheel of the other flavour. (python3: the ROCm
# 10.1.0 base has no `python` symlink, only `python3`.)
RUN python3 -c "import torch; print(torch.__version__, torch.version.hip, torch.version.cuda)" > /tmp/torch.base

# Ditto's non-torch requirements (the PyTorch stream pipeline at the pinned
# commit needs mediapipe + onnxruntime, which the official environment.yaml —
# the TensorRT path — does not list; einops is imported by the core LMDM model).
RUN pip install \
         cython \
         onnxruntime \
         mediapipe \
         einops \
         librosa \
         imageio \
         imageio-ffmpeg \
         opencv-python-headless \
         scikit-image \
         scipy \
         numba \
         filetype \
         tqdm \
         colored \
         soundfile \
         huggingface_hub \
    && python3 -c "import onnxruntime, mediapipe, librosa, imageio, cv2, skimage, scipy, numba, filetype, tqdm, colored, soundfile, einops, torch; print('deps ok; torch', torch.__version__)" \
    && ffmpeg -version | head -1
RUN python3 -c "import torch; print(torch.__version__, torch.version.hip, torch.version.cuda)" | diff - /tmp/torch.base \
    || { echo 'pip replaced the base image torch (ROCm/CUDA flavour changed): pin or exclude the dependency' >&2; exit 1; }

# Ditto pinned at the verified commit (the PyTorch stream pipeline); bump
# deliberately, then re-verify.
ARG DITTO_COMMIT=c3e47eee2e626500017a0556b470d6d4182f85e8
RUN git clone --filter=blob:none https://github.com/antgroup/ditto-talkinghead /opt/ditto \
    && git -C /opt/ditto checkout ${DITTO_COMMIT}

# Pre-compile Ditto's blend.pyx (pyximport is gone from Cython 3) — the fleet's recipe.
COPY blend.sh /opt/ditto-build/blend.sh
RUN sh /opt/ditto-build/blend.sh

COPY server.py /opt/avatar-server.py

ENV PORT=8082 \
    DITTO_DIR=/opt/ditto \
    DITTO_DATA_ROOT=/opt/ditto/checkpoints/ditto_pytorch \
    DITTO_CFG=/opt/ditto/checkpoints/ditto_cfg/v0.4_hubert_cfg_pytorch.pkl

EXPOSE 8082
CMD ["python3", "/opt/avatar-server.py"]
