/**
 * The 3D stage: one R3F canvas holding the Earth, sky, terminal, satellite and the
 * optical overlays. Quality presets trade effects for frame rate.
 */
import { Suspense, useMemo } from 'react';
import * as THREE from 'three';
import { Canvas, ThreeEvent, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { Earth, GroundSite } from './earth/Earth';
import { Sky, Moon, MOON_AZ, MOON_EL } from './sky/Sky';
import { GroundTerminal } from './models/GroundTerminal';
import { Satellite, SUN_DIR } from './models/Satellite';
import { Optics } from './overlays/Optics';
import { LabelProjector } from './Labels';
import { CameraRig } from './CameraRig';
import { VisBus } from './VisBus';
import { live, useApp } from '../state/store';
import { azElVec, MOON_DISTANCE_KM } from './world';

function Lights({ sunDir }: { sunDir: THREE.Vector3 }) {
  const quality = useApp((s) => s.quality);
  const sunEl = useApp((s) => s.config.scene.sunElDeg);
  const warm = useMemo(() => new THREE.Color().lerpColors(new THREE.Color('#ff9a5a'), new THREE.Color('#fff4e6'), THREE.MathUtils.clamp((sunEl + 2) / 25, 0, 1)), [sunEl]);
  const light = useMemo(() => {
    // Sunlight. At twilight the ground is in the Earth's shadow while the spacecraft is
    // still sunlit; one directional light serves both, slightly softened.
    const l = new THREE.DirectionalLight(warm, 2.4);
    l.position.copy(sunDir).multiplyScalar(0.05);
    l.target.position.set(0, 0.003, 0);
    l.castShadow = quality === 'high';
    l.shadow.mapSize.set(2048, 2048);
    const c = l.shadow.camera as THREE.OrthographicCamera;
    c.left = c.bottom = -0.009;
    c.right = c.top = 0.009;
    c.near = 0.001;
    c.far = 0.12;
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.00002;
    return l;
  }, [sunDir, quality, warm]);
  return (
    <>
      <primitive object={light} />
      <primitive object={light.target} />
      <hemisphereLight args={['#2a3f66', '#1a1612', 0.55]} />
      {/* Earthshine on the spacecraft's nadir side. */}
      <directionalLight position={[0, -1, 0]} intensity={0.25} color="#5b86c9" />
    </>
  );
}

function Env() {
  return (
    <Environment resolution={128} frames={1} background={false}>
      <Lightformer form="rect" intensity={2.2} color="#ffb070" position={[6, 0.6, -2]} scale={[12, 1.2, 1]} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={0.8} color="#6d8fd6" position={[0, 6, 0]} scale={[14, 14, 1]} target={[0, 0, 0]} />
      <Lightformer form="ring" intensity={1.4} color="#e8f0ff" position={[-5, 2, 4]} scale={2} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={0.3} color="#2a2018" position={[0, -5, 0]} scale={[14, 14, 1]} target={[0, 0, 0]} />
    </Environment>
  );
}

function Effects() {
  const quality = useApp((s) => s.quality);
  if (quality === 'low') return null;
  return (
    <EffectComposer multisampling={quality === 'high' ? 4 : 0} enableNormalPass={false}>
      <Bloom mipmapBlur intensity={quality === 'high' ? 0.95 : 0.75} luminanceThreshold={0.82} luminanceSmoothing={0.2} radius={0.72} />
      <Vignette offset={0.28} darkness={0.55} />
    </EffectComposer>
  );
}

function Picker() {
  const measure = useApp((s) => s.measure);
  const gl = useThree((s) => s.gl);
  gl.domElement.style.cursor = measure.enabled ? 'crosshair' : '';
  return null;
}

function addPick(id: string, name: string, pos: [number, number, number]) {
  const st = useApp.getState();
  if (!st.measure.enabled) return;
  const picks = [...st.measure.picks, { id, name, pos }].slice(-2);
  st.set({ measure: { ...st.measure, picks } });
}

export function Stage() {
  const quality = useApp((s) => s.quality);
  const sunAz = useApp((s) => s.config.scene.sunAzDeg);
  const sunEl = useApp((s) => s.config.scene.sunElDeg);
  const sunDir = useMemo(() => azElVec(sunAz, sunEl).normalize(), [sunAz, sunEl]);
  SUN_DIR.copy(sunDir);
  const dpr: [number, number] = quality === 'low' ? [1, 1] : quality === 'medium' ? [1, 1.5] : [1, 2];

  const onPick = (e: ThreeEvent<MouseEvent>) => {
    if (!useApp.getState().measure.enabled) return;
    e.stopPropagation();
    let o: THREE.Object3D | null = e.object;
    while (o && !o.userData.measure) o = o.parent;
    const id = o?.userData.measure as string | undefined;
    if (id === 'terminal') addPick('terminal', 'Ground terminal', [0, 0, 0]);
    else if (id === 'satellite') addPick('satellite', 'Remote terminal', (live.snap?.target.posKm ?? [0, 0, 0]) as [number, number, number]);
    else if (id === 'moon') {
      const p = azElVec(MOON_AZ, MOON_EL, MOON_DISTANCE_KM);
      addPick('moon', 'Moon', [p.x, p.y, p.z]);
    } else addPick(`ground-${Date.now()}`, 'Surface point', [e.point.x, e.point.y, e.point.z]);
  };

  return (
    <Canvas
      className="stage-canvas"
      dpr={dpr}
      shadows={quality === 'high'}
      gl={{ logarithmicDepthBuffer: true, antialias: quality !== 'low', powerPreference: 'high-performance', preserveDrawingBuffer: false }}
      camera={{ fov: 42, near: 0.0002, far: 3e6, position: [300, 250, 200] }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
    >
      <color attach="background" args={['#020409']} />
      <VisBus />
      <Picker />
      <Suspense fallback={null}>
        <Env />
      </Suspense>
      <Lights sunDir={sunDir} />
      <Sky sunDir={sunDir} />
      <group onClick={onPick}>
        <Earth sunDir={sunDir} />
        <Moon sunDir={sunDir} />
        <GroundSite />
        <GroundTerminal />
        <Satellite />
      </group>
      <Optics />
      <LabelProjector />
      <CameraRig />
      <Effects />
    </Canvas>
  );
}
