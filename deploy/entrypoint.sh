#!/bin/sh
# Set the hsa_fix preload only for the ROCm variant (the CUDA base has no
# /opt/hsa_fix and must not LD_PRELOAD the ROCm runtime).
set -eu
if [ "${DECK_VARIANT:-cuda}" = "rocm" ]; then
    export LD_PRELOAD=/opt/hsa_fix/hsa_shim.so:/opt/hsa_fix/libhsa-runtime64.so.1.18.0
    export LD_LIBRARY_PATH=/opt/hsa_fix/lib
fi
exec "$@"
