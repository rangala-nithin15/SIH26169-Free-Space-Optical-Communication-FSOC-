/**
 * Remote terminal: a LEO spacecraft carrying an optical communication terminal and
 * the acquisition beacon (modelled in metres, rendered in km with iconic scaling).
 *
 * Meaningful animation only: the body stays nadir-pointed, the solar array drive
 * tracks the Sun, and the optical head's coarse pointing assembly points at the
 * ground terminal. The beacon is the emissive source the ground camera detects.
 */
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { makeMaterials } from './materials';
import { vis } from '../vis';
import { EARTH_CENTER } from '../world';

function Wing({ side, m, wingRef }: { side: 1 | -1; m: ReturnType<typeof makeMaterials>; wingRef: React.RefObject<THREE.Group | null> }) {
  return (
    <group position={[side * 0.95, 0.1, 0]}>
      <mesh material={m.silver} position={[side * 0.35, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.03, 0.03, 0.7, 8]} />
      </mesh>
      <mesh material={m.darkMetal}>
        <cylinderGeometry args={[0.09, 0.09, 0.14, 16]} />
      </mesh>
      <group ref={wingRef} position={[side * 0.7, 0, 0]}>
        {[0, 1, 2].map((i) => (
          <group key={i} position={[side * (0.75 + i * 1.5), 0, 0]}>
            <mesh material={m.cells}>
              <boxGeometry args={[1.42, 0.03, 1.05]} />
            </mesh>
            <mesh material={m.panelBack} position={[0, -0.018, 0]}>
              <boxGeometry args={[1.42, 0.005, 1.05]} />
            </mesh>
          </group>
        ))}
        <mesh material={m.silver} position={[side * 2.25, 0.03, 0]}>
          <boxGeometry args={[4.5, 0.02, 0.04]} />
        </mesh>
      </group>
    </group>
  );
}

export function Satellite() {
  const m = useMemo(makeMaterials, []);
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const wingL = useRef<THREE.Group>(null);
  const wingR = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.Sprite>(null);
  const beaconAnchor = useRef<THREE.Object3D>(null);
  const tmp = useMemo(
    () => ({ x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3(), mat: new THREE.Matrix4(), q: new THREE.Quaternion(), d: new THREE.Vector3() }),
    [],
  );
  const glow = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.15, 'rgba(200,245,255,0.9)');
    g.addColorStop(0.4, 'rgba(120,210,255,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);

  const dish = useMemo(() => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 16; i++) {
      const r = (i / 16) * 0.42;
      pts.push(new THREE.Vector2(r, (r * r) / 0.5));
    }
    return new THREE.LatheGeometry(pts, 40);
  }, []);

  useFrame(() => {
    if (!root.current || !body.current) return;
    root.current.position.copy(vis.sat);
    root.current.scale.setScalar(0.001 * vis.satScale);
    // Nadir pointing: body +y = radial (zenith), body +z roughly along-track.
    tmp.y.copy(vis.sat).sub(EARTH_CENTER).normalize();
    tmp.z.set(0, 0, -1);
    if (vis.satVel.lengthSq() > 1e-8) tmp.z.copy(vis.satVel).normalize();
    tmp.x.crossVectors(tmp.y, tmp.z);
    if (tmp.x.lengthSq() < 1e-6) tmp.x.set(1, 0, 0);
    tmp.x.normalize();
    tmp.z.crossVectors(tmp.x, tmp.y).normalize();
    tmp.mat.makeBasis(tmp.x, tmp.y, tmp.z);
    body.current.quaternion.setFromRotationMatrix(tmp.mat);
    // Solar array drive: rotate each wing about body x to face the Sun.
    const sunLocal = SUN_DIR.clone().applyQuaternion(body.current.quaternion.clone().invert());
    const ang = Math.atan2(sunLocal.z, sunLocal.y);
    if (wingL.current) wingL.current.rotation.x = ang;
    if (wingR.current) wingR.current.rotation.x = ang;
    // Optical head: point the telescope (local −z) at the ground terminal.
    if (head.current) {
      tmp.d.copy(vis.lens).sub(vis.sat).normalize().applyQuaternion(body.current.quaternion.clone().invert());
      tmp.q.setFromUnitVectors(new THREE.Vector3(0, 0, -1), tmp.d);
      head.current.quaternion.slerp(tmp.q, 0.2);
    }
    if (beacon.current && beaconAnchor.current) {
      beaconAnchor.current.getWorldPosition(beacon.current.position);
      vis.beacon.copy(beacon.current.position);
      const s = (vis.state === 'LOCKED' ? 0.05 : 0.036 + 0.012 * Math.sin(vis.time * 6)) * (vis.pov ? 0.14 : 1);
      beacon.current.scale.set(s, s, 1);
    }
  });

  return (
    <>
    <group ref={root} userData={{ measure: 'satellite' }}>
      <group ref={body}>
        {/* bus */}
        <mesh material={m.gold}>
          <boxGeometry args={[1.25, 1.25, 1.7]} />
        </mesh>
        {[-1, 1].map((sx) => (
          <mesh key={sx} material={m.radiator} position={[sx * 0.63, 0, 0]} rotation={[0, (sx * Math.PI) / 2, 0]}>
            <planeGeometry args={[1.5, 1.1]} />
          </mesh>
        ))}
        <mesh material={m.darkMetal} position={[0, 0.66, 0]}>
          <boxGeometry args={[1.3, 0.06, 1.75]} />
        </mesh>
        <mesh material={m.darkMetal} position={[0, -0.66, 0]}>
          <boxGeometry args={[1.3, 0.06, 1.75]} />
        </mesh>
        {/* solar wings */}
        <Wing side={1} m={m} wingRef={wingR} />
        <Wing side={-1} m={m} wingRef={wingL} />
        {/* star trackers (zenith side, baffled) */}
        {[-0.3, 0.3].map((x) => (
          <group key={x} position={[x, 0.82, 0.55]} rotation={[0.5, 0, x]}>
            <mesh material={m.blackAnod}>
              <cylinderGeometry args={[0.07, 0.09, 0.26, 16, 1, true]} />
            </mesh>
            <mesh material={m.silver} position={[0, -0.14, 0]}>
              <boxGeometry args={[0.16, 0.06, 0.16]} />
            </mesh>
          </group>
        ))}
        {/* GNSS patch + magnetorquer rods */}
        <mesh material={m.whitePaint} position={[0, 0.7, -0.5]}>
          <cylinderGeometry args={[0.1, 0.1, 0.03, 20]} />
        </mesh>
        {[-0.45, 0.45].map((x) => (
          <mesh key={x} material={m.darkMetal} position={[x, 0.45, 0.88]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.025, 0.025, 0.5, 8]} />
          </mesh>
        ))}
        {/* thrusters */}
        {[
          [-0.5, -0.5],
          [0.5, -0.5],
          [-0.5, 0.5],
          [0.5, 0.5],
        ].map(([x, y]) => (
          <mesh key={`${x}${y}`} material={m.silver} position={[x, y, 0.9]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.03, 0.06, 0.1, 12, 1, true]} />
          </mesh>
        ))}
        {/* high-gain antenna on a boom (downlink RF) */}
        <group position={[0.35, -0.62, 0.95]}>
          <mesh material={m.silver} position={[0, -0.25, 0]}>
            <cylinderGeometry args={[0.025, 0.025, 0.5, 8]} />
          </mesh>
          <mesh geometry={dish} material={m.whitePaint} position={[0, -0.72, 0]} rotation={[Math.PI, 0, 0]} />
          <mesh material={m.darkMetal} position={[0, -0.55, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 0.3, 6]} />
          </mesh>
        </group>
        {/* optical communication terminal on the nadir face, on a 2-axis coarse pointing assembly */}
        <group position={[-0.22, -0.8, -0.3]}>
          <mesh material={m.blackAnod}>
            <cylinderGeometry args={[0.2, 0.22, 0.14, 24]} />
          </mesh>
          <group ref={head} position={[0, -0.18, 0]}>
            {[-1, 1].map((sx) => (
              <mesh key={sx} material={m.blackAnod} position={[sx * 0.17, 0.02, 0]}>
                <boxGeometry args={[0.04, 0.22, 0.1]} />
              </mesh>
            ))}
            <mesh material={m.whitePaint} position={[0, 0, -0.05]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.13, 0.13, 0.45, 28]} />
            </mesh>
            <mesh material={m.blackAnod} position={[0, 0, -0.33]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.14, 0.135, 0.14, 28, 1, true]} />
            </mesh>
            <mesh material={m.lens} position={[0, 0, -0.28]}>
              <circleGeometry args={[0.115, 32]} />
            </mesh>
            {/* beacon laser emitter */}
            <mesh position={[0.1, 0.12, -0.3]}>
              <sphereGeometry args={[0.03, 12, 12]} />
              <meshBasicMaterial color={[3, 5, 6]} toneMapped={false} />
            </mesh>
            <object3D ref={beaconAnchor} position={[0.1, 0.12, -0.34]} />
          </group>
        </group>
      </group>
    </group>
    {/* Beacon glow lives outside the scaled model so its screen size is constant. */}
    <sprite ref={beacon} renderOrder={5}>
      <spriteMaterial map={glow} color={[2.2, 3.4, 4]} sizeAttenuation={false} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </sprite>
    </>
  );
}

/** Sun direction shared with the satellite (set by the stage). */
export const SUN_DIR = new THREE.Vector3(0, 1, 0);
