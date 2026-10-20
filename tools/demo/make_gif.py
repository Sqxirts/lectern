"""Turn record.mjs screencast frames into the README GIF.

Usage: python tools/demo/make_gif.py <frames-dir> <out.gif> [width]

Screencast frames only arrive when the screen changes, so each frame's
duration is the gap to the next timestamp. Frames closer than MIN_MS are
merged to keep the file small.
"""
import sys
from pathlib import Path

from PIL import Image

MIN_MS = 70        # about 14 fps at most
LAST_HOLD_MS = 2500
MAX_HOLD_MS = 2500


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    width = int(sys.argv[3]) if len(sys.argv) > 3 else 960
    files = sorted(src.glob("*.png"))
    stamps = [float(f.stem.split("_")[1]) for f in files]

    picked, durations = [], []
    for i, f in enumerate(files):
        gap = (stamps[i + 1] - stamps[i]) * 1000 if i + 1 < len(files) else LAST_HOLD_MS
        if picked and durations[-1] < MIN_MS:
            # previous frame was too short to show; replace it with this one
            picked[-1] = f
            durations[-1] += gap
        else:
            picked.append(f)
            durations.append(gap)
    durations = [int(min(max(d, MIN_MS), MAX_HOLD_MS)) for d in durations]

    frames = []
    for f in picked:
        im = Image.open(f).convert("RGB")
        h = round(im.height * width / im.width)
        im = im.resize((width, h), Image.LANCZOS)
        frames.append(im.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))

    frames[0].save(out, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True, disposal=1)
    total = sum(durations) / 1000
    print(f"{len(frames)} frames, {total:.1f}s, {out.stat().st_size / 1e6:.2f} MB -> {out}")


if __name__ == "__main__":
    main()
