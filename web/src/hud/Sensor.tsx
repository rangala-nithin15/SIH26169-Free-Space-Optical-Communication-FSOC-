/**
 * Optical sensor feed: the actual 8-bit frame rendered by the engine and processed by
 * the detector, with measurement overlays. Nothing here is decorative imagery.
 */
import { useEffect, useRef } from 'react';
import { live, stateColor, STATE_HEX, useApp } from '../state/store';
import type { Snapshot, TrackState } from '../core/telemetry/types';
import { Icon, fmt, fmtSigned } from './ui';

const STEPS: { key: keyof Snapshot['timeline']; label: string; states: TrackState[] }[] = [
  { key: 'search', label: 'SEARCH', states: ['SEARCHING', 'REACQUIRING'] },
  { key: 'detect', label: 'DETECT', states: ['DETECTED'] },
  { key: 'acquire', label: 'ACQUIRE', states: ['ACQUIRING'] },
  { key: 'track', label: 'TRACK', states: ['TRACKING', 'LOST'] },
  { key: 'lock', label: 'LOCK', states: ['LOCKED'] },
];

function drawOverlay(ctx: CanvasRenderingContext2D, s: Snapshot, W: number, H: number, sc: number, opts: { truth: boolean; calibration: boolean; roi: boolean; lockPx: number; acqPx: number }) {
  const cw = s.camera.width;
  const ch = s.camera.height;
  const cx = cw / 2;
  const cy = ch / 2;
  const X = (x: number) => x * sc;
  const Y = (y: number) => y * sc;
  const col = STATE_HEX[s.state];
  ctx.lineWidth = 1;
  ctx.font = `${Math.max(10, 10.5 * Math.min(1.4, sc))}px "IBM Plex Mono", monospace`;
  ctx.textBaseline = 'top';

  // Calibration grid: gnomonic degree lines from the camera model (x = cx + fx·tan u).
  if (opts.calibration) {
    ctx.strokeStyle = 'rgba(143,220,255,0.18)';
    ctx.fillStyle = 'rgba(143,220,255,0.55)';
    const stepDeg = s.camera.hfovDeg > 8 ? 2 : 0.5;
    for (let k = -40; k <= 40; k++) {
      const a = (k * stepDeg * Math.PI) / 180;
      const x = cx + s.camera.fx * Math.tan(a);
      const y = cy - s.camera.fx * Math.tan(a);
      if (x > 0 && x < cw) {
        ctx.beginPath();
        ctx.moveTo(X(x), 0);
        ctx.lineTo(X(x), H);
        ctx.stroke();
        if (k !== 0) ctx.fillText(`${(k * stepDeg).toFixed(1)}°`, X(x) + 3, H - 40);
      }
      if (y > 0 && y < ch) {
        ctx.beginPath();
        ctx.moveTo(0, Y(y));
        ctx.lineTo(W, Y(y));
        ctx.stroke();
      }
    }
    ctx.fillText(`principal point (${cx}, ${cy}) · f = ${s.camera.fx.toFixed(0)} px`, 8, 24);
  }

  // Reticle: centre cross with gap, corner brackets, lock + acquisition circles.
  ctx.strokeStyle = 'rgba(232,240,247,0.55)';
  const g = 6;
  const L = 18;
  ctx.beginPath();
  ctx.moveTo(X(cx) - L - g, Y(cy));
  ctx.lineTo(X(cx) - g, Y(cy));
  ctx.moveTo(X(cx) + g, Y(cy));
  ctx.lineTo(X(cx) + L + g, Y(cy));
  ctx.moveTo(X(cx), Y(cy) - L - g);
  ctx.lineTo(X(cx), Y(cy) - g);
  ctx.moveTo(X(cx), Y(cy) + g);
  ctx.lineTo(X(cx), Y(cy) + L + g);
  ctx.stroke();
  const m = 14;
  const b = 22;
  ctx.strokeStyle = 'rgba(232,240,247,0.35)';
  for (const [sx, sy] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]) {
    const x0 = sx ? W - m : m;
    const y0 = sy ? H - m : m;
    ctx.beginPath();
    ctx.moveTo(x0 + (sx ? -b : b), y0);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x0, y0 + (sy ? -b : b));
    ctx.stroke();
  }
  ctx.strokeStyle = s.state === 'LOCKED' ? 'rgba(156,245,200,0.85)' : 'rgba(156,245,200,0.4)';
  ctx.beginPath();
  ctx.arc(X(cx), Y(cy), opts.lockPx * sc, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = 'rgba(232,240,247,0.22)';
  ctx.beginPath();
  ctx.arc(X(cx), Y(cy), opts.acqPx * sc, 0, Math.PI * 2);
  ctx.stroke();

  // ROI
  if (opts.roi && s.roi && (s.roi[2] - s.roi[0] < cw - 2 || s.roi[3] - s.roi[1] < ch - 2)) {
    ctx.strokeStyle = 'rgba(143,220,255,0.35)';
    ctx.strokeRect(X(s.roi[0]), Y(s.roi[1]), X(s.roi[2] - s.roi[0]), Y(s.roi[3] - s.roi[1]));
    ctx.fillStyle = 'rgba(143,220,255,0.55)';
    ctx.fillText('ROI', X(s.roi[0]) + 3, Y(s.roi[1]) + 3);
  }
  ctx.setLineDash([]);

  // Other candidates (rejected blobs).
  ctx.strokeStyle = 'rgba(255,208,138,0.35)';
  for (const c of s.candidates.slice(1)) {
    ctx.beginPath();
    ctx.arc(X(c.x), Y(c.y), 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Kalman prediction + 3σ ellipse.
  if (s.kalman.predPx) {
    const [px, py] = s.kalman.predPx;
    ctx.strokeStyle = 'rgba(255,208,138,0.75)';
    ctx.beginPath();
    ctx.moveTo(X(px), Y(py) - 6);
    ctx.lineTo(X(px) + 6, Y(py));
    ctx.lineTo(X(px), Y(py) + 6);
    ctx.lineTo(X(px) - 6, Y(py));
    ctx.closePath();
    ctx.stroke();
    const [sx, sy] = s.kalman.sigmaPx;
    if (sx > 0.3 && sy > 0.3) {
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.ellipse(X(px), Y(py), Math.min(3 * sx * sc, W), Math.min(3 * sy * sc, H), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Ground truth (simulation only; off by default).
  if (opts.truth && s.target.truthPx) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.arc(X(s.target.truthPx[0]), Y(s.target.truthPx[1]), 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('truth (sim)', X(s.target.truthPx[0]) + 12, Y(s.target.truthPx[1]) - 14);
  }

  // Detection: bbox corners, centroid, error vector.
  const d = s.detection;
  if (d) {
    const dc = d.accepted ? col : 'rgba(255,107,94,0.9)';
    const [x0, y0, x1, y1] = d.bbox;
    const pad = 4;
    const bx0 = X(x0) - pad;
    const by0 = Y(y0) - pad;
    const bx1 = X(x1 + 1) + pad;
    const by1 = Y(y1 + 1) + pad;
    const k = Math.min(9, (bx1 - bx0) / 3);
    ctx.strokeStyle = dc;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [ax, ay, dx, dy] of [
      [bx0, by0, 1, 1],
      [bx1, by0, -1, 1],
      [bx0, by1, 1, -1],
      [bx1, by1, -1, -1],
    ]) {
      ctx.moveTo(ax + dx * k, ay);
      ctx.lineTo(ax, ay);
      ctx.lineTo(ax, ay + dy * k);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(X(d.x) - 4, Y(d.y));
    ctx.lineTo(X(d.x) + 4, Y(d.y));
    ctx.moveTo(X(d.x), Y(d.y) - 4);
    ctx.lineTo(X(d.x), Y(d.y) + 4);
    ctx.stroke();
    // error vector from the image centre
    ctx.strokeStyle = 'rgba(255,181,71,0.8)';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(X(cx), Y(cy));
    ctx.lineTo(X(d.x), Y(d.y));
    ctx.stroke();
    ctx.setLineDash([]);
    const ex = d.x - cx;
    const ey = d.y - cy;
    ctx.fillStyle = dc;
    const lx = Math.min(W - 170, bx1 + 6);
    const ly = Math.max(4, by0 - 2);
    ctx.fillText(`DET (${d.x.toFixed(1)}, ${d.y.toFixed(1)})`, lx, ly);
    ctx.fillStyle = 'rgba(232,240,247,0.85)';
    ctx.fillText(`Δ (${fmtSigned(ex)}, ${fmtSigned(ey)}) px`, lx, ly + 14);
    ctx.fillText(`${(d.confidence * 100).toFixed(0)} % · SNR ${d.snr.toFixed(0)}`, lx, ly + 28);
  }

  // Text frame.
  ctx.fillStyle = 'rgba(232,240,247,0.75)';
  ctx.fillText(`FSOC-CAM · ${cw}×${ch} · MONO 8-bit`, 8, 8);
  ctx.textAlign = 'right';
  ctx.fillStyle = col;
  ctx.fillText(s.state, W - 8, 8);
  ctx.fillStyle = 'rgba(232,240,247,0.6)';
  ctx.fillText(`centre (${cx}, ${cy})`, W - 8, 22);
  ctx.textBaseline = 'bottom';
  ctx.fillText(`frame ${s.frame} · t ${s.t.toFixed(2)} s`, W - 8, H - 6);
  ctx.textAlign = 'left';
  ctx.fillText(`FOV ${s.camera.hfovDeg.toFixed(2)}° × ${s.camera.vfovDeg.toFixed(2)}°`, 8, H - 6);
  ctx.textBaseline = 'top';
}

export function SensorView() {
  const expanded = useApp((s) => s.sensorExpanded);
  const overlays = useApp((s) => s.overlays);
  const logic = useApp((s) => s.config.logic);
  const kind = useApp((s) => s.providerKind);
  const hud = useApp((s) => s.hud);
  const set = useApp((s) => s.set);
  const toggleOverlay = useApp((s) => s.toggleOverlay);
  const canvas = useRef<HTMLCanvasElement>(null);
  const off = useRef<HTMLCanvasElement | null>(null);
  const opts = useRef({ truth: false, calibration: false, roi: true, lockPx: 10, acqPx: 30 });
  opts.current = { truth: overlays.truth, calibration: overlays.calibration, roi: overlays.roi, lockPx: logic.lockPx, acqPx: logic.acquirePx };

  useEffect(() => {
    let raf = 0;
    let lastImg = -1;
    let lastFrame = -1;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      const snap = live.snap;
      if (!c || !snap) return;
      const img = live.image;
      if (live.imageVersion === lastImg && snap.frame === lastFrame) return;
      lastFrame = snap.frame;
      const rect = c.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.round(rect.width * dpr);
      const H = Math.round(rect.height * dpr);
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      // Choose the snapshot that matches the displayed image (images arrive at a lower rate).
      let s = snap;
      if (img) {
        if (live.imageVersion !== lastImg) {
          lastImg = live.imageVersion;
          if (!off.current) off.current = document.createElement('canvas');
          const o = off.current;
          if (o.width !== img.width || o.height !== img.height) {
            o.width = img.width;
            o.height = img.height;
          }
          const octx = o.getContext('2d')!;
          const id = octx.createImageData(img.width, img.height);
          const d = id.data;
          const src = img.data;
          for (let i = 0, j = 0; i < src.length; i++, j += 4) {
            const v = src[i];
            d[j] = v * 0.94;
            d[j + 1] = v * 0.98;
            d[j + 2] = v;
            d[j + 3] = 255;
          }
          octx.putImageData(id, 0, 0);
        }
        const match = live.recent.find((r) => r.frame === img.frame);
        if (match) s = match;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(off.current!, 0, 0, W, H);
      } else {
        ctx.fillStyle = 'rgba(232,240,247,0.5)';
        ctx.font = `${12 * dpr}px "IBM Plex Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(useApp.getState().providerKind === 'replay' ? 'REPLAY · images are not recorded — overlays only' : 'NO SIGNAL', W / 2, H / 2 - 20);
        ctx.textAlign = 'left';
      }
      drawOverlay(ctx, s, W, H, W / s.camera.width, opts.current);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const d = hud?.detection;
  const e = hud?.error;
  return (
    <>
      {expanded && <div className="backdrop" onClick={() => set({ sensorExpanded: false })} />}
      <section className={`sensor glass ${expanded ? 'expanded' : ''}`}>
        <div className="sensor-head">
          <div className="eyebrow">
            Optical sensor · detection {kind === 'replay' ? <span className="tag">recorded</span> : <span className="tag sim">live frame</span>}
          </div>
          <div className="row">
            <button className={`btn icon sm ghost ${overlays.calibration ? 'on' : ''}`} title="Calibration grid (degrees)" onClick={() => toggleOverlay('calibration')}>
              <Icon name="crosshair" size={15} />
            </button>
            <button className="btn icon sm ghost" title="Expand (S)" onClick={() => set({ sensorExpanded: !expanded })}>
              <Icon name={expanded ? 'close' : 'expand'} size={15} />
            </button>
          </div>
        </div>
        <div className="sensor-canvas-wrap">
          <canvas ref={canvas} />
        </div>
        <div className="sensor-foot">
          <div>
            <div className="eyebrow">Centroid</div>
            <div className="v">{d ? `${d.x.toFixed(1)}, ${d.y.toFixed(1)}` : '—'}</div>
          </div>
          <div>
            <div className="eyebrow">Pixel error</div>
            <div className="v" style={{ color: e?.magPx !== null && (e?.magPx ?? 99) < logic.lockPx ? 'var(--lock)' : undefined }}>{fmt(e?.estMagPx, 1, ' px')}</div>
          </div>
          <div>
            <div className="eyebrow">Angular err</div>
            <div className="v">{fmt(e?.angDeg, 3, '°')}</div>
          </div>
          <div>
            <div className="eyebrow">Confidence</div>
            <div className="v">{d ? `${(d.confidence * 100).toFixed(0)} %` : '—'}</div>
          </div>
        </div>
      </section>
    </>
  );
}

export function Timeline() {
  const hud = useApp((s) => s.hud);
  const events = useApp((s) => s.events);
  const expanded = useApp((s) => s.sensorExpanded);
  if (expanded) return null;
  const state = hud?.state ?? 'IDLE';
  const lastTr = [...events].reverse().find((e) => e.kind === 'transition');
  return (
    <section className="timeline glass">
      <div className="eyebrow">Mission timeline · first time reached</div>
      <div className="tl-track">
        {STEPS.map((st) => {
          const t = hud?.timeline[st.key] ?? null;
          const active = st.states.includes(state);
          const color = active ? stateColor(state) : t !== null ? 'var(--text)' : 'var(--text-3)';
          return (
            <div key={st.key} className={`tl-step ${active ? 'active' : ''}`} style={{ color }}>
              <div className="bar">
                <i style={{ transform: `scaleX(${t !== null || active ? 1 : 0})`, opacity: active ? 1 : 0.45 }} />
              </div>
              <div className="n">{st.label}</div>
              <div className="t">{t !== null ? `${t.toFixed(2)} s` : '—'}</div>
            </div>
          );
        })}
      </div>
      {lastTr && (
        <div className="tl-reason">
          <span className="mono">{lastTr.t.toFixed(2)}s</span>
          <span>
            <b style={{ color: stateColor(lastTr.to) }}>{lastTr.to}</b> — {lastTr.message}
          </span>
        </div>
      )}
    </section>
  );
}
