#!/bin/sh
# Runs at image build time. Ditto's blend/__init__.py calls
# pyximport.install() to compile blend.pyx on the fly, but pyximport is gone
# from Cython 3 and PyPI. So compile the .so here and install a no-op
# pyximport, letting `from .blend import ...` load the prebuilt module.
set -e
PKG=/opt/ditto/core/utils/blend
cd "$PKG"

python3 -m cython -3 blend.pyx

# Flags per the repo's blend.pyxbld recipe, except -march=native: the image must run
# on a CPU other than the build host (native code can die with "illegal instruction").
NP_INC=$(python3 -c "import numpy; print(numpy.get_include())")
PY_INC=$(python3 -c "import sysconfig; print(sysconfig.get_config_var('INCLUDEPY'))")
EXT_SUFFIX=$(python3 -c "import sysconfig; print(sysconfig.get_config_var('EXT_SUFFIX'))")
gcc -shared -fPIC -O3 -std=c99 -mtune=generic -ffast-math \
    -I"$NP_INC" -I"$PY_INC" -I"$PKG" \
    blend.c blend_impl.c \
    -o "blend${EXT_SUFFIX}"

SITE=$(python3 -c "import site; print(site.getsitepackages()[0])")
cat > "$SITE/pyximport.py" <<'PY'
# No-op shim for the deprecated Cython 2.x pyximport module.
# Ditto's blend/__init__.py calls pyximport.install() to trigger an on-the-fly
# cython compile; the .so is pre-compiled at image build time (blend.sh),
# so install() is a harmless no-op here.
def install(*args, **kwargs):
    pass
PY

echo "=== blend build done ==="
ls -la "$PKG"/blend*
python3 -c "import sys; sys.path.insert(0,'/opt/ditto/core/utils/blend'); import blend; print('blend import ok:', hasattr(blend,'blend_images_cy'))"
