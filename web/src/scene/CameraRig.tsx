/**
 * Viewpoint presets. "sensor" puts the 3D camera at the terminal's lens with the
 * terminal camera's true FOV — the 3D equivalent of the sensor feed.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { CameraControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useApp } from '../state/store';
import { vis } from './vis';
import { EARTH_CENTER, EARTH_R } from './world';
import { basisFromAzEl } from '../core/geometry';
import { SUN_DIR } from './models/Satellite';

const UP = new THREE.Vector3(0, 1, 0);

export function CameraRig() {
  const ref = useRef<CameraControls>(null);
  const view = useApp((s) => s.view);
  const nonce = useApp((s) => s.viewNonce);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const hud = useRef({ at: 0, right: 414, bottom: 250 });

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const S = vis.sat.clone();
    if (S.lengthSq() < 1) S.set(-300, 500, -600);
    const l = S.clone().normalize();
    const side = new THREE.Vector3().crossVectors(l, UP).normalize();
    const lh = new THREE.Vector3(l.x, 0, l.z).normalize();
    const R = S.length();
    // In sensor POV the orbit controls are disabled and the pose is set directly each frame.
    c.enabled = view !== 'sensor';
    if (view !== 'sensor') {
      camera.fov = 42;
      camera.updateProjectionMatrix();
      camera.up.set(0, 1, 0);
      c.updateCameraUp();
    }
    let pos: THREE.Vector3 | null = null;
    let tgt: THREE.Vector3 | null = null;
    switch (view) {
      case 'overview':
        {
          // Look at the middle of the link from the side, just far enough that terminal and
          // satellite both fit inside the part of the screen not covered by the HUD.
          const fracV = Math.max(0.3, (size.height - hud.current.bottom - 100) / size.height);
          const fracH = Math.max(0.3, (size.width - hud.current.right - 66) / size.width);
          const halfV = THREE.MathUtils.degToRad(42 / 2) * fracV;
          const halfH = Math.atan(Math.tan(THREE.MathUtils.degToRad(21)) * (size.width / size.height)) * fracH;
          const d = (0.56 * R) / Math.sin(Math.min(halfV, halfH));
          const dir = side.clone().multiplyScalar(-1).addScaledVector(UP, 0.12).addScaledVector(lh, -0.12).normalize();
          tgt = S.clone().multiplyScalar(0.5);
          pos = tgt.clone().addScaledVector(dir, d);
        }
        break;
      case 'terminal':
        pos = new THREE.Vector3().addScaledVector(side, -0.019).addScaledVector(UP, 0.0075).addScaledVector(lh, -0.012);
        tgt = new THREE.Vector3(0, 0.0036, 0).addScaledVector(lh, 0.0015);
        break;
      case 'link':
        // Spacecraft view: just above and behind the satellite, looking down the link.
        pos = S.clone().addScaledVector(side, -48).addScaledVector(UP, 16).addScaledVector(l, 14);
        tgt = S.clone().addScaledVector(l, -6);
        break;
      case 'orbit': {
        const sunH = new THREE.Vector3(SUN_DIR.x, 0, SUN_DIR.z).normalize();
        const dir = UP.clone().multiplyScalar(0.8).addScaledVector(sunH, 0.5).addScaledVector(side, -0.25).normalize();
        pos = EARTH_CENTER.clone().addScaledVector(dir, EARTH_R + 17000);
        tgt = EARTH_CENTER.clone().addScaledVector(UP, EARTH_R * 0.55);
        break;
      }
      default:
        break;
    }
    if (pos && tgt) c.setLookAt(pos.x, pos.y, pos.z, tgt.x, tgt.y, tgt.z, nonce > 0);
  }, [view, nonce, camera, size]);

  const lastSat = useRef<THREE.Vector3 | null>(null);
  const tmpP = useRef(new THREE.Vector3());
  const tmpT = useRef(new THREE.Vector3());
  useFrame(() => {
    // Follow the moving remote terminal in the views that are framed on it.
    const follow = view === 'link' ? 1 : view === 'overview' ? 0.5 : 0;
    if (lastSat.current && follow > 0 && ref.current) {
      const d = vis.sat.clone().sub(lastSat.current).multiplyScalar(follow);
      if (d.lengthSq() > 1e-10 && d.length() < 200) {
        ref.current.getPosition(tmpP.current);
        ref.current.getTarget(tmpT.current);
        tmpP.current.add(d);
        tmpT.current.add(d);
        ref.current.setLookAt(tmpP.current.x, tmpP.current.y, tmpP.current.z, tmpT.current.x, tmpT.current.y, tmpT.current.z, false);
      }
    }
    lastSat.current = vis.sat.clone();
    // Shift the principal point to the centre of the area not covered by the HUD
    // (left tool rail, right sensor column, bottom dock) so the scene is framed there.
    if (view !== 'sensor') {
      // Measure the HUD occasionally (it is responsive) and centre the scene in the free area.
      const now = performance.now();
      if (now - hud.current.at > 500) {
        const rc = document.querySelector('.rightcol')?.getBoundingClientRect();
        const dk = document.querySelector('.dock')?.getBoundingClientRect();
        hud.current = { at: now, right: rc ? size.width - rc.left : 414, bottom: dk ? size.height - dk.top : 250 };
      }
      const ox = Math.round((hud.current.right - 66) / 2);
      const oy = Math.round((hud.current.bottom - 100) / 2);
      const v = camera.view;
      if (!v || !v.enabled || v.offsetX !== ox || v.offsetY !== oy || v.fullWidth !== size.width || v.fullHeight !== size.height) {
        camera.setViewOffset(size.width, size.height, ox, oy, size.width, size.height);
      }
      return;
    }
    if (camera.view?.enabled) camera.clearViewOffset();
    // Sensor POV: the 3D camera sits just in front of the terminal's lens, looks along
    // the actual optical axis and uses the terminal camera's vertical FOV.
    const b = basisFromAzEl(vis.axisAz, vis.axisEl);
    const f = new THREE.Vector3(...b.f);
    camera.position.copy(vis.lens).addScaledVector(f, 0.0012);
    camera.up.set(...b.u);
    camera.lookAt(camera.position.clone().add(f));
    camera.updateMatrixWorld();
    if (Math.abs(camera.fov - vis.vfov) > 1e-3) {
      camera.fov = vis.vfov;
      camera.updateProjectionMatrix();
    }
  });

  useEffect(() => {
    // Test/debug handle (used by the automated UI checks in TEST_REPORT.md).
    (window as unknown as { __ASTRAQ_CAM__: unknown }).__ASTRAQ_CAM__ = { camera, controls: ref };
  }, [camera]);
  return (
    <CameraControls
      ref={ref}
      makeDefault
      minDistance={0.004}
      maxDistance={120000}
      dollySpeed={0.6}
      smoothTime={0.4}
      draggingSmoothTime={0.12}
      onStart={() => {
        const st = useApp.getState();
        if (st.view !== 'free' && st.view !== 'sensor') st.set({ view: 'free' });
      }}
    />
  );
}
