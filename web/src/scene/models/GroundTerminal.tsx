/**
 * Mobile FSOC ground terminal (modelled in metres, rendered in km).
 *
 * Hierarchy (a real azimuth-over-elevation gimbal):
 *   VEHICLE BASE (heading 150°)
 *     └─ MAST TOP MOUNT (north-referenced after levelling)
 *          └─ PAN AXIS  (rotation about local up  = −azimuth)
 *               └─ TILT AXIS (rotation about local east = +elevation)
 *                    └─ OPTICAL PAYLOAD: telescope, acquisition camera, lens, beacon
 */
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { makeMaterials } from './materials';
import { TERMINAL_HEADING_DEG, vis } from '../vis';
import { STATE_HEX, useApp } from '../../state/store';

const MAST_TOP = 6.45; // m
const TILT_AXIS_UP = 0.5; // m above the pan turntable

function Wheel({ x, z, m }: { x: number; z: number; m: ReturnType<typeof makeMaterials> }) {
  return (
    <group position={[x, 0.5, z]} rotation={[0, 0, Math.PI / 2]}>
      <mesh material={m.rubber} castShadow>
        <cylinderGeometry args={[0.5, 0.5, 0.38, 36]} />
      </mesh>
      <mesh material={m.darkMetal} position={[0, Math.sign(x) * 0.2, 0]}>
        <cylinderGeometry args={[0.28, 0.3, 0.04, 24]} />
      </mesh>
      <mesh material={m.silver} position={[0, Math.sign(x) * 0.225, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 0.03, 16]} />
      </mesh>
    </group>
  );
}

function Outrigger({ x, z, m }: { x: number; z: number; m: ReturnType<typeof makeMaterials> }) {
  const sx = Math.sign(x);
  return (
    <group position={[x, 0, z]}>
      <mesh material={m.darkMetal} position={[sx * 0.35, 0.95, 0]}>
        <boxGeometry args={[0.8, 0.12, 0.14]} />
      </mesh>
      <mesh material={m.silver} position={[sx * 0.72, 0.5, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.9, 12]} />
      </mesh>
      <mesh material={m.darkMetal} position={[sx * 0.72, 0.9, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 0.2, 12]} />
      </mesh>
      <mesh material={m.darkMetal} position={[sx * 0.72, 0.025, 0]} receiveShadow>
        <cylinderGeometry args={[0.2, 0.22, 0.05, 20]} />
      </mesh>
    </group>
  );
}

export function GroundTerminal() {
  const m = useMemo(makeMaterials, []);
  const quality = useApp((s) => s.quality);
  const root = useRef<THREE.Group>(null);
  const mount = useRef<THREE.Group>(null);
  const pan = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const lensAnchor = useRef<THREE.Object3D>(null);
  const status = useRef<THREE.MeshStandardMaterial>(null);
  const beaconLamp = useRef<THREE.MeshStandardMaterial>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  const cable = useMemo(() => {
    const pts = [
      new THREE.Vector3(0.55, 3.08, 1.55),
      new THREE.Vector3(0.35, 3.3, 1.45),
      new THREE.Vector3(0.18, 4.2, 1.28),
      new THREE.Vector3(0.16, 5.4, 1.27),
      new THREE.Vector3(0.2, 6.3, 1.28),
      new THREE.Vector3(0.12, 6.55, 1.2),
    ];
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.022, 8, false);
  }, []);
  const cable2 = useMemo(() => {
    const pts = [new THREE.Vector3(-0.9, 1.3, 2.35), new THREE.Vector3(-1.0, 0.8, 2.5), new THREE.Vector3(-0.8, 0.35, 2.7), new THREE.Vector3(-0.4, 0.03, 3.2)];
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.03, 8, false);
  }, []);

  useFrame(() => {
    if (!root.current || !pan.current || !tilt.current || !mount.current) return;
    const s = vis.terminalScale;
    root.current.scale.setScalar(0.001 * s);
    // Pan: azimuth is clockwise from north → rotation about +y is −az.
    pan.current.rotation.y = -THREE.MathUtils.degToRad(vis.pan);
    tilt.current.rotation.x = THREE.MathUtils.degToRad(vis.tilt);
    // Platform disturbance (what the encoders cannot see) tilts the mast top slightly.
    mount.current.rotation.set(THREE.MathUtils.degToRad(vis.dTilt), THREE.MathUtils.degToRad(TERMINAL_HEADING_DEG) - THREE.MathUtils.degToRad(vis.dPan), 0);
    if (lensAnchor.current) {
      lensAnchor.current.getWorldPosition(tmp);
      vis.lens.copy(tmp);
    }
    const col = STATE_HEX[vis.state];
    if (status.current) {
      status.current.emissive.set(col);
      const blink = vis.state === 'SEARCHING' || vis.state === 'REACQUIRING' ? 0.4 + 0.6 * Math.abs(Math.sin(vis.time * 4)) : 1;
      status.current.emissiveIntensity = 3 * blink;
    }
    if (beaconLamp.current) beaconLamp.current.emissiveIntensity = vis.state === 'LOCKED' ? 3 + Math.sin(vis.time * 10) : 0.4;
  });

  const heading = -THREE.MathUtils.degToRad(TERMINAL_HEADING_DEG);
  const shadows = quality === 'high';

  return (
    <group ref={root} userData={{ measure: 'terminal' }}>
      <group rotation={[0, heading, 0]}>
        {/* ── Vehicle ─────────────────────────────────────────── */}
        {[-1.05, 1.05].map((x) => [-1.75, 0.35, 1.6].map((z) => <Wheel key={`${x}${z}`} x={x} z={z} m={m} />))}
        <mesh material={m.body} position={[0, 1.05, 0]} castShadow={shadows}>
          <boxGeometry args={[2.2, 0.42, 5.3]} />
        </mesh>
        {/* cab */}
        <group position={[0, 1.95, -1.95]}>
          <mesh material={m.body} castShadow={shadows}>
            <boxGeometry args={[2.15, 1.4, 1.35]} />
          </mesh>
          <mesh material={m.glass} position={[0, 0.25, -0.69]} rotation={[-0.18, 0, 0]}>
            <planeGeometry args={[1.9, 0.72]} />
          </mesh>
          {[-1, 1].map((sx) => (
            <mesh key={sx} material={m.glass} position={[sx * 1.08, 0.25, -0.05]} rotation={[0, (sx * Math.PI) / 2, 0]}>
              <planeGeometry args={[0.9, 0.6]} />
            </mesh>
          ))}
          <mesh material={m.amber} position={[0, 0.74, 0.1]}>
            <boxGeometry args={[1.1, 0.08, 0.16]} />
          </mesh>
          <mesh material={m.darkMetal} position={[0.6, 0.78, 0.3]}>
            <cylinderGeometry args={[0.07, 0.07, 0.05, 16]} />
          </mesh>
          {[-1, 1].map((sx) => (
            <mesh key={sx} material={m.darkMetal} position={[sx * 1.18, 0.35, -0.55]}>
              <boxGeometry args={[0.05, 0.28, 0.16]} />
            </mesh>
          ))}
        </group>
        {/* equipment shelter */}
        <mesh material={m.shelter} position={[0, 2.2, 1.0]} castShadow={shadows} receiveShadow={shadows}>
          <boxGeometry args={[2.1, 1.7, 2.9]} />
        </mesh>
        <mesh material={m.darkMetal} position={[0, 3.08, 1.0]}>
          <boxGeometry args={[2.16, 0.06, 2.96]} />
        </mesh>
        {/* status strip on the shelter front */}
        <mesh position={[0.62, 2.72, -0.46]}>
          <boxGeometry args={[0.5, 0.06, 0.02]} />
          <meshStandardMaterial ref={status} color="#111" emissive="#ffb547" emissiveIntensity={3} toneMapped={false} />
        </mesh>
        {/* work lights */}
        {[-0.85, 0.85].map((x) => (
          <group key={x} position={[x, 3.2, -0.35]}>
            <mesh material={m.darkMetal}>
              <boxGeometry args={[0.18, 0.12, 0.1]} />
            </mesh>
            <mesh position={[0, 0, -0.051]}>
              <planeGeometry args={[0.15, 0.09]} />
              <meshStandardMaterial color="#fff5e0" emissive="#ffd9a0" emissiveIntensity={2.5} toneMapped={false} />
            </mesh>
            {/* Scene units are km: a point light's intensity scales with distance², hence the tiny value. */}
            {quality !== 'low' && <pointLight position={[0, -0.2, -0.4]} color="#ffcf94" intensity={1.5e-5} distance={0.03} decay={2} />}
          </group>
        ))}
        {/* whip antenna + GPS */}
        <mesh material={m.blackAnod} position={[-0.95, 3.8, 2.35]}>
          <cylinderGeometry args={[0.012, 0.02, 1.4, 6]} />
        </mesh>
        <mesh material={m.whitePaint} position={[0.8, 3.14, 2.2]}>
          <cylinderGeometry args={[0.09, 0.1, 0.06, 20]} />
        </mesh>
        {[-1.2, 1.2].map((x) => [-0.2, 2.35].map((z) => <Outrigger key={`${x}${z}`} x={x} z={z} m={m} />))}
        <mesh geometry={cable2} material={m.cable} />

        {/* ── Telescopic mast ─────────────────────────────────── */}
        <group position={[0, 3.1, 1.25]}>
          <mesh material={m.silver} position={[0, 0.7, 0]} castShadow={shadows}>
            <cylinderGeometry args={[0.15, 0.16, 1.4, 20]} />
          </mesh>
          <mesh material={m.darkMetal} position={[0, 1.42, 0]}>
            <cylinderGeometry args={[0.18, 0.18, 0.08, 20]} />
          </mesh>
          <mesh material={m.silver} position={[0, 2.0, 0]} castShadow={shadows}>
            <cylinderGeometry args={[0.115, 0.12, 1.2, 20]} />
          </mesh>
          <mesh material={m.darkMetal} position={[0, 2.62, 0]}>
            <cylinderGeometry args={[0.14, 0.14, 0.07, 20]} />
          </mesh>
          <mesh material={m.silver} position={[0, 3.0, 0]} castShadow={shadows}>
            <cylinderGeometry args={[0.088, 0.092, 0.8, 20]} />
          </mesh>
          <mesh material={m.darkMetal} position={[0, 0.02, 0]}>
            <cylinderGeometry args={[0.32, 0.36, 0.08, 24]} />
          </mesh>
        </group>
        <mesh geometry={cable} material={m.cable} />
        {[4.2, 5.3].map((y) => (
          <mesh key={y} material={m.blackAnod} position={[0.13, y, 1.27]}>
            <boxGeometry args={[0.08, 0.05, 0.08]} />
          </mesh>
        ))}

        {/* ── Gimbal: mast-top mount (north-referenced) ───────── */}
        <group position={[0, MAST_TOP, 1.25]}>
          <group ref={mount}>
            <mesh material={m.blackAnod} position={[0, 0.03, 0]}>
              <cylinderGeometry args={[0.2, 0.2, 0.06, 28]} />
            </mesh>
            {/* PAN AXIS */}
            <group ref={pan}>
              <mesh material={m.blackAnod} position={[0, 0.12, 0]} castShadow={shadows}>
                <cylinderGeometry args={[0.26, 0.26, 0.12, 36]} />
              </mesh>
              <mesh material={m.silver} position={[0, 0.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.265, 0.012, 8, 64]} />
              </mesh>
              <mesh material={m.darkMetal} position={[0.3, 0.1, 0.05]} rotation={[0, 0, 0]}>
                <cylinderGeometry args={[0.07, 0.07, 0.16, 16]} />
              </mesh>
              <mesh material={m.blackAnod} position={[0, 0.2, 0]}>
                <boxGeometry args={[0.86, 0.05, 0.2]} />
              </mesh>
              {[-1, 1].map((sx) => (
                <mesh key={sx} material={m.blackAnod} position={[sx * 0.4, 0.46, 0]} castShadow={shadows}>
                  <boxGeometry args={[0.07, 0.55, 0.17]} />
                </mesh>
              ))}
              {/* TILT AXIS */}
              <group ref={tilt} position={[0, TILT_AXIS_UP + 0.2, 0]}>
                <mesh material={m.silver} rotation={[0, 0, Math.PI / 2]}>
                  <cylinderGeometry args={[0.035, 0.035, 0.92, 12]} />
                </mesh>
                {[-1, 1].map((sx) => (
                  <group key={sx} position={[sx * 0.49, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                    <mesh material={m.darkMetal}>
                      <cylinderGeometry args={[0.09, 0.09, 0.12, 20]} />
                    </mesh>
                    <mesh position={[0, sx * 0.065, 0]}>
                      <cylinderGeometry args={[0.07, 0.07, 0.015, 20]} />
                      <meshStandardMaterial color="#3aa6d6" emissive="#1f7fa8" emissiveIntensity={0.6} metalness={0.5} roughness={0.3} />
                    </mesh>
                  </group>
                ))}
                {/* OPTICAL PAYLOAD (points along −z) */}
                <mesh material={m.whitePaint} position={[0, 0, -0.08]} rotation={[Math.PI / 2, 0, 0]} castShadow={shadows}>
                  <cylinderGeometry args={[0.19, 0.19, 0.92, 40]} />
                </mesh>
                <mesh material={m.blackAnod} position={[0, 0, -0.68]} rotation={[Math.PI / 2, 0, 0]}>
                  <cylinderGeometry args={[0.205, 0.2, 0.34, 40, 1, true]} />
                </mesh>
                <mesh material={m.blackAnod} position={[0, 0, -0.52]} rotation={[Math.PI / 2, 0, 0]}>
                  <torusGeometry args={[0.19, 0.015, 8, 40]} />
                </mesh>
                <mesh material={m.lens} position={[0, 0, -0.535]}>
                  <circleGeometry args={[0.175, 48]} />
                </mesh>
                <object3D ref={lensAnchor} position={[0, 0, -0.55]} />
                {/* secondary mirror spider */}
                <mesh material={m.blackAnod} position={[0, 0, -0.55]}>
                  <cylinderGeometry args={[0.045, 0.045, 0.03, 16]} />
                </mesh>
                {/* rear electronics + counterweight */}
                <mesh material={m.darkMetal} position={[0, -0.02, 0.48]}>
                  <boxGeometry args={[0.3, 0.26, 0.2]} />
                </mesh>
                <mesh material={m.blackAnod} position={[0, -0.24, 0.3]}>
                  <boxGeometry args={[0.22, 0.1, 0.28]} />
                </mesh>
                {/* acquisition camera on top */}
                <group position={[0, 0.27, -0.12]}>
                  <mesh material={m.blackAnod}>
                    <boxGeometry args={[0.13, 0.12, 0.26]} />
                  </mesh>
                  <mesh material={m.lens} position={[0, 0, -0.131]}>
                    <circleGeometry args={[0.04, 24]} />
                  </mesh>
                  <mesh material={m.darkMetal} position={[0, -0.08, 0]}>
                    <boxGeometry args={[0.06, 0.05, 0.1]} />
                  </mesh>
                </group>
                {/* uplink beacon emitter on the side */}
                <group position={[0.25, 0.05, -0.25]} rotation={[Math.PI / 2, 0, 0]}>
                  <mesh material={m.silver}>
                    <cylinderGeometry args={[0.035, 0.035, 0.3, 16]} />
                  </mesh>
                  <mesh position={[0, -0.155, 0]}>
                    <circleGeometry args={[0.03, 16]} />
                    <meshStandardMaterial ref={beaconLamp} color="#9cf5c8" emissive="#9cf5c8" emissiveIntensity={0.4} toneMapped={false} side={THREE.DoubleSide} />
                  </mesh>
                </group>
                {/* status LEDs on the back plate */}
                {[-0.07, 0, 0.07].map((x, i) => (
                  <mesh key={x} position={[x, 0.07, 0.585]}>
                    <sphereGeometry args={[0.014, 8, 8]} />
                    <meshStandardMaterial color="#111" emissive={['#9cf5c8', '#8fdcff', '#ffb547'][i]} emissiveIntensity={2} toneMapped={false} />
                  </mesh>
                ))}
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
