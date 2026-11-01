#!/usr/bin/env python3
"""render — render all slide voice-overs for the slide deck.

Source of truth: ../slides.md — the speaker notes already embedded in each
slide as HTML comments (`<!-- one sentence per line -->`). No intermediate
slide-NN-*.txt files; the generator picks the text from slides.md as-is.

TTS-safe normalization is applied on the fly (numbers spelled out, % ->
percent, QTI -> Q TI, emphasis/html stripped).

Reads every slide's notes, POSTs them to the local Kokoro TTS server
(OpenAI-compatible /v1/audio/speech). Output goes to ../dist/voiceover/ as
slide-NN-<slug>.mp3 (slug = the slide's heading; stable across re-runs).
Stale mp3s in dist/voiceover/ are pruned on each run and regenerated.

Stdlib-only.

Env:
  TTS_BASE  default http://127.0.0.1:8880/v1
  VOICE     default am_adam
  SPEED     default 1.0

Usage:
  render.py [VOICE] [--base URL]   # re-render every slide
"""
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SLIDES = os.path.normpath(os.path.join(HERE, "..", "slides.md"))
VO = os.path.normpath(os.path.join(HERE, "..", "dist", "voiceover"))

COMMENT = re.compile(r"<!--.*?-->", flags=re.S)

WORDS = "zero one two three four five six seven eight nine ten eleven twelve thirteen " \
        "fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty".split()
TEN = {2: "twenty", 3: "thirty", 4: "forty", 5: "fifty", 6: "sixty",
       7: "seventy", 8: "eighty", 9: "ninety"}


def num_w(n):
    n = int(n)
    if n < 20:
        return WORDS[n]
    if n < 100:
        tens, rem = divmod(n, 10)
        return TEN[tens] + (" " + WORDS[rem] if rem else "")
    h, rem = divmod(n, 100)
    return WORDS[h] + " hundred" + (" " + num_w(rem) if rem else "")


def tts_safe(t):
    t = COMMENT.sub(" ", t)
    t = re.sub(r"</?[^>]*>", " ", t)            # stray HTML (div/stats in notes)
    t = t.replace("*", "").replace("`", "")
    t = re.sub(r"\bQTI\b", "Q TI", t)
    t = re.sub(r"\b(\d+)\.x\b", lambda m: f"{num_w(m.group(1))} point x", t)
    t = re.sub(r"\b(\d+)\.(\d+)\b", lambda m: f"{num_w(m.group(1))} point {num_w(m.group(2))}", t)
    t = re.sub(r"\b(\d+)%", lambda m: f"{num_w(m.group(1))} percent", t)
    t = re.sub(r"\b(\d+)", lambda m: num_w(m.group(1)), t)
    t = t.replace("—", " ").replace("–", " ").replace("§", " section ")
    t = re.sub(r"\s+", " ", t).strip()
    return t


def notes_per_slide(src):
    """Return [(heading, note text), ...] in slide order.

    Note text = every non-directive HTML comment of the slide, joined —
    the same lines Marp's presenter view shows. Visible slide content
    (headers, lists, stats divs) is never spoken. Front matter (the
    first --- block) is excluded; Marp directive comments
    (<!-- _class: ... -->) are skipped.
    """
    lines = src.split("\n")
    close = next(i for i, ln in enumerate(lines) if ln.strip() == "---" and i > 0)
    deck = lines[close + 1:]
    slides, cur = [], []
    for ln in deck:
        if ln.strip() == "---":
            slides.append(cur)
            cur = []
        else:
            cur.append(ln)
    slides.append(cur)

    def heading(block):
        for line in block:
            m = re.match(r"\s*#{1,2}\s+(.*\S)", line)
            if m:
                return m.group(1).strip()
        return ""

    out = []
    for block in slides:
        texts = []
        for line in block:
            s = line.strip()
            if not (s.startswith("<!--") and s.endswith("-->")):
                continue
            inner = s[4:-3].strip()
            if re.fullmatch(r"_\w+:.*", inner):      # Marp directive, not a note
                continue
            t = tts_safe(inner)
            if t:
                texts.append(t)
        out.append((heading(block), " ".join(texts).strip()))
    return out


def slugify(s):
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return re.sub(r"-+", "-", s)[:40] or "part"


def unique_name(used, base):
    name, k = base, 1
    while name in used:
        k += 1
        name = f"{base}-{k}"
    used.add(name)
    return name


def synth(base, text, voice, speed, out):
    body = json.dumps({
        "input": text, "voice": voice, "response_format": "mp3", "speed": speed,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/audio/speech", data=body,
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=300) as r, open(out, "wb") as f:
        f.write(r.read())
    return os.path.getsize(out)


def main():
    argv = [a for a in sys.argv[1:] if not a.startswith("--")]
    opts = {a: sys.argv[i + 1] for i, a in enumerate(sys.argv)
            if a.startswith("--") and i + 1 < len(sys.argv)}
    base = (opts.get("--base") or os.environ.get("TTS_BASE")
            or "http://127.0.0.1:8880/v1").rstrip("/")
    voice = argv[0] if argv else (os.environ.get("VOICE") or "am_adam")
    speed = float(os.environ.get("SPEED", "1.0"))

    src = open(SLIDES, encoding="utf-8").read()
    notes = notes_per_slide(src)
    if not notes:
        sys.exit(f"no slides found in {SLIDES}")
    for i, (_, t) in enumerate(notes, start=1):
        if not t:
            sys.exit(f"slide {i:02d}: no speaker notes found (<!-- one per line -->)")

    # prune stale mp3s from previous voiceover generations (txt-file era)
    if os.path.isdir(VO):
        for f in os.listdir(VO):
            if f.endswith(".mp3"):
                os.remove(os.path.join(VO, f))
                print(f"rm  {f}  (old voice-over, regenerates below)")

    os.makedirs(VO, exist_ok=True)
    used = set()
    for i, (head, text) in enumerate(notes, start=1):
        base_name = f"slide-{i:02d}-{slugify(head)}" if head else f"slide-{i:02d}"
        name = unique_name(used, base_name)
        out = os.path.join(VO, name + ".mp3")
        size = synth(base, text, voice, speed, out)
        print(f"ok  {name}.mp3  ({size} bytes, {len(text)} chars)")


if __name__ == "__main__":
    main()
