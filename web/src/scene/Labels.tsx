/**
 * Minimal scene labels. The label DOM lives outside the canvas (<SceneLabels/>); an
 * in-scene projector moves it every frame. No extra React roots are created.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { vis } from './vis';
import { useApp } from '../state/store';

const IDS = ['aq-label-terminal', 'aq-label-remote', 'aq-label-link'] as const;

function Tag({ id, title, sub, tone }: { id: string; title: string; sub?: string; tone?: 'ice' | 'lock' }) {
  return (
    <div id={id} className={`scene-tag ${tone ?? ''}`} style={{ position: 'absolute', left: 0, top: 0, display: 'none' }}>
      <span className="scene-tag-rule" />
      <span className="scene-tag-text">
        <b>{title}</b>
        {sub && <i>{sub}</i>}
      </span>
    </div>
  );
}

/** DOM part: rendered once, above the canvas and below the HUD. */
export function SceneLabels() {
  const remote = useApp((s) => s.config.scene.remote);
  const alt = useApp((s) => s.config.scene.altitudeKm);
  const remoteName = remote === 'leo' ? `LEO · ${alt.toFixed(0)} km` : remote === 'haps' ? 'HAPS' : 'UAV';
  return (
    <div className="scene-labels" aria-hidden>
      <Tag id={IDS[0]} title="Mobile FSOC terminal" sub="pan/tilt gimbal · optical camera" />
      <Tag id={IDS[1]} title="Remote terminal" sub={`${remoteName} · optical beacon`} tone="ice" />
      <Tag id={IDS[2]} title="Optical link" sub="coarse alignment locked" tone="lock" />
    </div>
  );
}

/** Scene part: projects the anchor points and positions the DOM labels. */
export function LabelProjector() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const { overlays, view } = useApp.getState();
    const hidden = !overlays.labels || view === 'sensor';
    const anchors: (THREE.Vector3 | null)[] = [
      new THREE.Vector3(0, 0.0078 * vis.terminalScale, 0),
      vis.sat.clone().add(new THREE.Vector3(0, 0.0035 * vis.satScale, 0)),
      vis.state === 'LOCKED' ? vis.lens.clone().lerp(vis.beacon, 0.55) : null,
    ];
    IDS.forEach((id, i) => {
      const el = document.getElementById(id);
      if (!el) return;
      const a = anchors[i];
      if (hidden || !a) {
        el.style.display = 'none';
        return;
      }
      tmp.copy(a).project(camera);
      const onScreen = tmp.z < 1 && tmp.z > -1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05;
      if (!onScreen) {
        el.style.display = 'none';
        return;
      }
      const x = ((tmp.x + 1) / 2) * size.width;
      const y = ((1 - tmp.y) / 2) * size.height;
      el.style.display = 'flex';
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(0, -100%)`;
    });
  });
  return null;
}
