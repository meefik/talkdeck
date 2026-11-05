# talkdeck/tts — Qwen3-TTS (official model) behind an OpenAI-compatible server.
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
# The model weights are NOT baked in (a ~10 GB image is a poor pull): the server
# downloads them into the mounted /models volume on the first start (see the
# README) and loads them from QWEN_BASE_MODEL / QWEN_VD_MODEL.

# The base image, chosen per variant (set in the compose files).
ARG BASE=docker.io/pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime
FROM ${BASE}

ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1

# Remember which torch the base image ships (ROCm or CUDA build): a pip dependency
# must not replace it with a PyPI wheel of the other flavour. (python3: the ROCm
# 10.1.0 base has no `python` symlink, only `python3`.)
RUN python3 -c "import torch; print(torch.__version__, torch.version.hip, torch.version.cuda)" > /tmp/torch.base

# qwen-tts (official, from PyPI) + soundfile (the wav output); librosa is a
# qwen-tts dep. ffmpeg decodes the reference audio; sox is a qwen-tts dep
# (the Python `sox` wrapper wants the CLI binary).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg sox \
    && rm -rf /var/lib/apt/lists/* \
    && pip install "qwen-tts==0.1.1" soundfile huggingface_hub
RUN python3 -c "import torch; print(torch.__version__, torch.version.hip, torch.version.cuda)" | diff - /tmp/torch.base \
    || { echo 'pip replaced the base image torch (ROCm/CUDA flavour changed): pin or exclude the dependency' >&2; exit 1; }

COPY server.py /opt/tts-server.py

ENV PORT=8081 \
    QWEN_BASE_MODEL=/models/Qwen3-TTS-12Hz-1.7B-Base \
    QWEN_VD_MODEL=/models/Qwen3-TTS-12Hz-1.7B-VoiceDesign \
    QWEN_LOAD=base,voicedesign

EXPOSE 8081
CMD ["python3", "/opt/tts-server.py"]
