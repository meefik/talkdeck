#!/usr/bin/env python3
"""make-video — build a presentation video: one slide per voice-over,
each slide fading in/out, concatenated in order.

Architecture (deliberately no xfade — concat of self-contained segments):
  per slide:  looped PNG (1920x1080) for the voice-over duration + PAD,
              with a 0.3 s fade-in / fade-out to black (first slide fades in
              from black for 0.5 s; last slide fades out to black for 0.5 s)
  audio:      the mp3, padded with silence to the segment length
  combine:    ffmpeg concat filter (v=1:a=1)

Pipeline:
  npm run pdf                        # dist/slides.pdf (marp, 16:9)
  pdftoppm -png -r 144               # dist/slides/slide-NN.png (1920x1080)
  ffmpeg                             # dist/deck-video.mp4

Inputs: dist/voiceover/slide-NN-*.mp3 (Kokoro TTS) — one per slide, durations via
        ffprobe.
Stdlib-only.

Usage:
  make-video.py              # rebuild everything (pdf + frames + video)
  make-video.py --no-pdf     # reuse existing dist/slides.pdf
  make-video.py --no-frames  # reuse existing dist/slides/slide-NN.png
"""
import os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DECK = os.path.join(HERE, "..")
PAD = 1.0     # silence after each voice-over, before the slide's fade-out (s)
FIN = 0.3     # fade-in length for interior slides (s)
FEND = 0.3    # fade-out length for interior slides (s)
FBOOK = 0.5   # bookend fade in (from black) / out (to black) (s)
W, H = 1920, 1080

args = set(sys.argv[1:])


def run(cmd, **kw):
    print("+", " ".join(str(c) for c in cmd), flush=True)
    subprocess.run([str(c) for c in cmd], cwd=DECK, check=True, **kw)


if not args & {"--no-pdf"}:
    run(["npm", "run", "pdf"])

frames_dir = os.path.join(DECK, "dist", "slides")
if not args & {"--no-frames"} or not os.path.isdir(frames_dir):
    os.makedirs(frames_dir, exist_ok=True)
    p = subprocess.run(
        ["pdftoppm", "-png", "-r", "144",
         "dist/slides.pdf", "dist/slides/slide"],
        cwd=DECK, check=True, capture_output=True, text=True)
    sys.stderr.write(p.stderr)

slides = sorted(f for f in os.listdir(frames_dir)
                if re.fullmatch(r"slide-\d+\.png", f))
mp3_dir = os.path.join(DECK, "dist", "voiceover")
mp3s = sorted(f for f in os.listdir(mp3_dir)
              if re.fullmatch(r"slide-\d+-[a-z0-9.+-]+\.mp3", f))
def num(name):
    m = re.search(r"\d+", name)
    assert m, name  # guaranteed by the re.fullmatch filter above
    return int(m.group())


assert slides and len(slides) == len(mp3s) and \
       [num(s) for s in slides] == [num(m) for m in mp3s], \
       "slide/frame/voice-over mismatch"


def dur(name):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", os.path.join(mp3_dir, name)],
        capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


n = len(slides)
d = [dur(m) for m in mp3s]
L = [x + PAD for x in d]                    # per-slide display duration (s)
T = sum(L)
last_end = sum(L[:-1]) + d[-1]
print(f"{n} slides, total {T:.1f}s, last voice-over ends {last_end:.1f}s")

fades = []
for i in range(n):
    fin = FBOOK if i == 0 else FIN
    fout = FBOOK if i == n - 1 else FEND
    if n == 1:
        fin = fout = FBOOK
    v = (f"[{2 * i}:v]scale={W}:{H},setsar=1,format=yuv420p,"
         f"fade=t=in:st=0:d={fin},"
         f"fade=t=out:st={L[i] - fout:.3f}:d={fout}:color=black[vi{i}]")
    # audio: pad to the segment length so concat stays in sync
    a = f"[{2 * i + 1}:a]apad=pad_dur={max(0.0, L[i] - d[i]):.3f}[ai{i}]"
    fades.extend([v, a])

graph = "; ".join(fades) + "; " + "".join(f"[vi{i}][ai{i}]" for i in range(n)) \
    + f"concat=n={n}:v=1:a=1[vout][aout]"

cmd = ["ffmpeg", "-y", "-v", "error"]
for i in range(n):
    cmd += ["-loop", "1", "-framerate", "30", "-t", f"{L[i]:.3f}",
            "-i", f"dist/slides/{slides[i]}",
            "-i", f"dist/voiceover/{mp3s[i]}"]
cmd += ["-filter_complex", graph,
        "-map", "[vout]", "-map", "[aout]",
        "-r", "30",
        "-c:v", "libx264", "-preset", "medium", "-crf", "19",
        "-c:a", "aac", "-b:a", "192k",
        "-t", f"{T:.3f}", "dist/deck-video.mp4"]
run(cmd)

print(f"\ndone  dist/deck-video.mp4  {T:.1f}s")
