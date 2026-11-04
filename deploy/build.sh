#!/bin/sh
# Build the deck backend images (podman or docker; set REGISTRY for the prefix).
#
#   ./build.sh            # all four images
#   ./build.sh tts        # the TTS image (cuda + rocm)
#   ./build.sh avatar     # the avatar image (cuda + rocm)
#
# The images need mirafleet/hsa-fix-build:latest (the ROCm variant COPYs from
# it). Build it first if it is missing:
#   (cd projects/fleet/build/hsa_fix && bash build.sh)
set -eu
REGISTRY="${REGISTRY:-mirafleet}"
which_cmd="${DOCKER:-podman}"
# The hsa_fix builder image is stored with a localhost/ prefix by podman.
HSABASE="mirafleet/hsa-fix-build:latest"
[ "$which_cmd" = "podman" ] && HSABASE="localhost/${HSABASE}"
CUDA_BASE="pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime"
ROCM_BASE="rocm/pytorch:rocm7.14_ubuntu24.04_py3.13_pytorch_release_2.12.0"

build() {
    name=$1
    for variant in cuda rocm; do
        base=$([ "$variant" = cuda ] && echo "$CUDA_BASE" || echo "$ROCM_BASE")
        tag="${REGISTRY}/deck-${name}:${variant}"
        echo "=== building ${tag} (base: ${base}) ==="
        $which_cmd build -f "Dockerfile.${name}" \
            --build-arg "VARIANT=${variant}" --build-arg "BASE=${base}" \
            --build-arg "HSABASE=${HSABASE}" \
            -t "$tag" .
    done
}

case "${1:-all}" in
    tts)    build tts ;;
    avatar) build avatar ;;
    all)    build tts; build avatar ;;
    *) echo "usage: $0 [tts|avatar|all]" >&2; exit 1 ;;
esac
echo "done: ${REGISTRY}/deck-tts:{cuda,rocm} ${REGISTRY}/deck-avatar:{cuda,rocm}"
