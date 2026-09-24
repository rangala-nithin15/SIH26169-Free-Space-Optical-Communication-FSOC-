"""
Detection providers (mirror of web/src/core/detection/*).

`DetectionProvider` is the extension point: implement `detect(frame, ctx)` and
register it in `create_detector`. A YOLO provider is NOT implemented — see
`YoloDetectionProvider` below, which raises a clear error instead of pretending.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Protocol

import numpy as np

try:  # OpenCV is optional; used only for fast connected-component labelling.
    import cv2

    HAVE_CV2 = True
except Exception:  # pragma: no cover
    HAVE_CV2 = False

from .optics import SensorFrame


@dataclass
class Candidate:
    x: float
    y: float
    bbox: tuple[int, int, int, int]
    area: int
    peak: float
    snr: float
    size_score: float
    confidence: float


@dataclass
class DetectionContext:
    predicted: tuple[float, float] | None
    tracking: bool
    gate_px: float
    expected_size_px: float
    threshold_sigma: float
    min_confidence: float
    rng: object
    truth: dict | None = None


@dataclass
class DetectionResult:
    detection: Candidate | None
    candidates: list[Candidate] = field(default_factory=list)
    proc_ms: float = 0.0
    roi: tuple[int, int, int, int] | None = None
    n_candidates: int = 0


class DetectionProvider(Protocol):
    id: str
    label: str
    needs_image: bool

    def detect(self, frame: SensorFrame | None, ctx: DetectionContext) -> DetectionResult: ...


def _label(mask: np.ndarray) -> tuple[int, np.ndarray]:
    if HAVE_CV2:
        n, lab = cv2.connectedComponents(mask.astype(np.uint8), connectivity=4)
        return n, lab
    # Pure-numpy/python fallback (4-connected flood fill over mask pixels only).
    lab = np.zeros(mask.shape, dtype=np.int32)
    h, w = mask.shape
    nid = 0
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if lab[y0, x0]:
            continue
        nid += 1
        stack = [(y0, x0)]
        lab[y0, x0] = nid
        while stack:
            y, x = stack.pop()
            for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = nid
                    stack.append((yy, xx))
    return nid + 1, lab


class CentroidDetector:
    """Classical CV beacon detector: impulse repair, 3x3 box filter, robust threshold,
    connected components, size/SNR scoring, prediction gating, weighted centroid."""

    id = "centroid"
    label = "Image centroid detector (threshold + connected components)"
    needs_image = True

    def detect(self, frame: SensorFrame | None, ctx: DetectionContext) -> DetectionResult:
        t0 = time.perf_counter()
        if frame is None:
            return DetectionResult(None)
        img = frame.data
        H, W = img.shape
        x0, y0, x1, y1 = 0, 0, W - 1, H - 1
        if ctx.tracking and ctx.predicted is not None:
            half = int(round(max(48, ctx.gate_px + ctx.expected_size_px * 1.5)))
            px, py = ctx.predicted
            if -half < px < W + half and -half < py < H + half:
                x0, y0 = max(0, int(np.floor(px - half))), max(0, int(np.floor(py - half)))
                x1, y1 = min(W - 1, int(np.ceil(px + half))), min(H - 1, int(np.ceil(py + half)))
        if x1 - x0 < 2 or y1 - y0 < 2:
            return DetectionResult(None, roi=(x0, y0, x1, y1))
        # Impulse repair with the true 8-neighbourhood (1-pixel context around the ROI).
        ex0, ey0, ex1, ey1 = max(0, x0 - 1), max(0, y0 - 1), min(W - 1, x1 + 1), min(H - 1, y1 + 1)
        ext = img[ey0 : ey1 + 1, ex0 : ex1 + 1].astype(np.float32)
        ext = np.pad(ext, 1, mode="constant", constant_values=np.nan)
        oy, ox = y0 - ey0 + 1, x0 - ex0 + 1
        h, w = y1 - y0 + 1, x1 - x0 + 1
        v = ext[oy : oy + h, ox : ox + w]
        extreme = (v >= 250) | (v <= 4)
        same = np.zeros(v.shape, np.int16)
        s_sum = np.zeros(v.shape, np.float32)
        s_cnt = np.zeros(v.shape, np.int16)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                q = ext[oy + dy : oy + dy + h, ox + dx : ox + dx + w]
                valid = ~np.isnan(q)
                sim = valid & (np.abs(q - v) <= 12)
                same += sim
                dis = valid & ~sim
                s_sum += np.where(dis, q, 0)
                s_cnt += dis
        work = np.where(extreme & (same < 3) & (s_cnt > 0), s_sum / np.maximum(s_cnt, 1), v).astype(np.float32)
        # 3x3 box mean with border-aware counts.
        p = np.pad(work, 1, mode="constant")
        ones = np.pad(np.ones_like(work), 1, mode="constant")
        acc = np.zeros_like(work)
        cnt = np.zeros_like(work)
        for dy in range(3):
            for dx in range(3):
                acc += p[dy : dy + h, dx : dx + w]
                cnt += ones[dy : dy + h, dx : dx + w]
        s = acc / cnt
        sample = s.ravel()[:: 3 if s.size > 40000 else 1]
        median = float(np.median(sample))
        mad = float(np.median(np.abs(sample - median)))
        sigma = max(0.35, 1.4826 * mad)
        cands = None
        for mult in (1.0, 2.5):
            thr = median + ctx.threshold_sigma * mult * sigma
            mask = s > thr
            if mask.sum() > 0.2 * s.size:
                continue
            cands = self._components(mask, work, s, median, sigma, x0, y0, ctx)
            break
        cands = cands or []
        best, best_score = None, 0.0
        for c in cands:
            score = c.confidence
            if ctx.tracking and ctx.predicted is not None:
                d2 = (c.x - ctx.predicted[0]) ** 2 + (c.y - ctx.predicted[1]) ** 2
                g = ctx.gate_px
                if d2 > 6.25 * g * g:
                    continue
                score *= float(np.exp(-d2 / (2 * g * g)))
            if score > best_score:
                best, best_score = c, score
        cands.sort(key=lambda c: -c.confidence)
        det = best if best is not None and best.confidence >= ctx.min_confidence else None
        return DetectionResult(det, cands[:6], (time.perf_counter() - t0) * 1000, (x0, y0, x1, y1), len(cands))

    def _components(self, mask, work, s, median, sigma, ox, oy, ctx) -> list[Candidate]:
        n, lab = _label(mask)
        if n <= 1:
            return []
        lab = lab.ravel()
        wt = np.clip(work.ravel() - median, 0, None)
        h, w = mask.shape
        yy, xx = np.divmod(np.arange(h * w), w)
        area = np.bincount(lab, minlength=n)
        sw = np.bincount(lab, weights=wt, minlength=n)
        swx = np.bincount(lab, weights=wt * (xx + 0.5), minlength=n)
        swy = np.bincount(lab, weights=wt * (yy + 0.5), minlength=n)
        peak = np.zeros(n)
        np.maximum.at(peak, lab, s.ravel())
        idx = np.nonzero(lab)[0]
        exp_area = (ctx.expected_size_px + 1.5) ** 2
        out: list[Candidate] = []
        for i in range(1, min(n, 65)):
            if area[i] < 2 or sw[i] <= 0:
                continue
            sel = idx[lab[idx] == i]
            bx, by = xx[sel], yy[sel]
            snr = (peak[i] - median) / sigma
            lr = np.log(area[i] / exp_area)
            size_score = float(np.exp(-(lr * lr) / (2 * 0.8 * 0.8)))
            snr_score = float(min(1.0, max(0.0, (snr - 6) / 24)) ** 0.6)
            conf = size_score**0.7 * snr_score
            out.append(
                Candidate(
                    float(ox + swx[i] / sw[i]),
                    float(oy + swy[i] / sw[i]),
                    (int(ox + bx.min()), int(oy + by.min()), int(ox + bx.max()), int(oy + by.max())),
                    int(area[i]),
                    float(peak[i]),
                    float(snr),
                    size_score,
                    conf,
                )
            )
        return out


class SyntheticDetector:
    """Statistical model of a detector (truth + noise + misses). Labelled as a model."""

    id = "synthetic"
    label = "Synthetic measurement model (truth + noise + misses)"
    needs_image = False

    def __init__(self, noise_px: float, miss_prob: float):
        self.noise_px, self.miss_prob = noise_px, miss_prob

    def detect(self, frame, ctx: DetectionContext) -> DetectionResult:
        tr = ctx.truth
        if not tr or tr.get("px") is None or not tr.get("visible"):
            return DetectionResult(None, proc_ms=0.01)
        T = tr["transmission"]
        ns = tr["noiseSigma"]
        rng = ctx.rng
        p_miss = min(0.99, self.miss_prob + 0.5 * (1 - T) ** 2 + 0.002 * ns)
        if rng.next() < p_miss:
            return DetectionResult(None, proc_ms=0.01)
        sigma = self.noise_px * (1 + ns / 10)
        x = tr["px"][0] + sigma * rng.gauss()
        y = tr["px"][1] + sigma * rng.gauss()
        conf = max(0.05, min(0.99, 0.97 * T**0.5 - ns / 150 + 0.02 * rng.gauss()))
        if conf < ctx.min_confidence:
            return DetectionResult(None, proc_ms=0.01)
        hf = ctx.expected_size_px / 2
        c = Candidate(x, y, (int(x - hf), int(y - hf), int(x + hf), int(y + hf)), int(ctx.expected_size_px**2), 0.0, 0.0, 1.0, conf)
        return DetectionResult(c, [c], 0.01, None, 1)


class YoloDetectionProvider:  # pragma: no cover - planned, not implemented
    """PLANNED. Integration point for a trained YOLO beacon model (e.g. ultralytics).

    Not implemented: ASTRAQ ships no trained model and makes no YOLO claims.
    To add one: load the model in __init__, run it on `frame.data` in detect(),
    convert the best box to a `Candidate` (centre = box centre or intensity
    centroid inside the box) and return a `DetectionResult`.
    """

    id = "yolo"
    label = "YOLO detector (planned)"
    needs_image = True

    def __init__(self, *_: object, **__: object):
        raise NotImplementedError("YOLO detection is planned, not implemented. See README section 20.")


def create_detector(cfg: dict):
    if cfg["provider"] == "synthetic":
        return SyntheticDetector(cfg["syntheticNoisePx"], cfg["syntheticMissProb"])
    return CentroidDetector()
