"""Generate a synthetic benchmark video with known beacon positions.

Usage (from server/):  python scripts/make_test_video.py out.mp4
Writes out.mp4 and out_truth.csv (frame,x,y) for POST /api/video/analyze.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from astraq_engine.video import synthesize_video  # noqa: E402

out = sys.argv[1] if len(sys.argv) > 1 else "astraq_test.mp4"
truth = synthesize_video(out, seconds=float(sys.argv[2]) if len(sys.argv) > 2 else 8.0)
tpath = os.path.splitext(out)[0] + "_truth.csv"
with open(tpath, "w") as f:
    f.write(truth)
print(f"wrote {out} and {tpath}")
