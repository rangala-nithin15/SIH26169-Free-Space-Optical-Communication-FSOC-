# ASTRAQ — Test Report

Environment: Linux x86-64 · Node.js 22.22 · npm 10.9 · Python 3.11.15 · Chromium 141 (headless, SwiftShader software WebGL) · 2026-09-24.
Every number below comes from commands run on the delivered code. Raw batch outputs are in `docs/test-results/`.

## 1. Build and static checks

| Check | Command | Result |
|---|---|---|
| Dependency installation | `cd web && npm install` · `pip install -r server/requirements.txt` | ✅ 0 npm vulnerabilities; all Python packages installed |
| TypeScript compilation | `npm run typecheck` (`tsc -b`, strict) | ✅ 0 errors |
| Lint | `npm run lint` (ESLint 9 + typescript-eslint + react-hooks) | ✅ 0 problems |
| Production build | `npm run build` | ✅ app 1.47 MB (408 kB gzip), coastline data 546 kB (lazy-loaded), engine worker 51 kB, batch worker 50 kB |
| Backend import | `python -c "import app.main"` | ✅ |
| API startup | `python -m uvicorn app.main:app --port 8000`, then `GET /api/health` | ✅ `{"ok":true,"engine":"astraq-python","video":true}` |
| Frontend startup | `npm run dev` and `npm run preview` in headless Chromium | ✅ scene loads, engine starts, state LOCKED at 1.57 s |
| Clean install from the ZIP | extract ZIP → `npm install` → `npm run build` | ✅ (see §7) |

## 2. Automated tests

### 2.1 Simulation core, TypeScript: `cd web && npm test` → **51 / 51 passed**
| Area | Tests |
|---|---|
| Geometry | az/el and gnomonic round-trips; orbital pass reaches the configured 62° max elevation; LEO speed 7.4–7.7 km/s; slant range at zenith |
| Camera | PS intrinsics (640×480, 4°×3°, 0.00625°/px, principal point 320,240); axis → principal point; half-FOV → image edge; unproject∘project = identity; behind-camera rejection |
| Trajectories | all 8 field patterns stay inside the search field and never jump more than 6°/s over 60 s; pattern switch without teleport; random starts differ by seed; orbital target lags the prediction |
| Sensor + detector | beacon rendered where the camera model projects it; **sub-pixel centroid (< 0.5 px)**; still detected under the **PS maxima (10 % salt & pepper, σ = 20)** (< 1.5 px); no detection on pure noise; fog lowers the spot peak; synthetic provider labelled as a model |
| Kalman | converges on a constant-velocity target and estimates the rate; innovation gate rejects a 2° outlier |
| PID / gimbal / search | output clamped and integrator bounded (anti-windup); gimbal rate and tilt limits; **pan and tilt independently controllable**; spiral search covers the whole field |
| State machine | SEARCHING→DETECTED→ACQUIRING→TRACKING→LOCKED on real inputs; misses → LOST → REACQUIRING → SEARCHING; a single noise hit is not confirmed |
| Closed loop | 7 trajectories each acquire ≤ 2 s, RMS error ≤ 10 px, loss < 5 %; target and gimbal both move; dropouts → LOST → reacquired; **Kalman+FF beats raw measurements**; manual mode reaches commanded angles; demo runs all 6 phases and is deterministic per seed |
| Analysis / recording | link budget inverse-square (+6.02 dB per range doubling), fog margin loss, fine hand-over; wide-field acquisition raises P(acq); atmosphere ordering; CSV header = documented columns, one row per frame; JSON recording |

### 2.2 Python engine and API: `cd server && python -m pytest` → **30 / 30 passed**
Covers the same core checks (geometry, camera, detector sub-pixel accuracy and PS-maximum noise, noise rejection, Kalman rate, PID/gimbal limits, state machine, 7 closed-loop trajectories, dropout → LOST → reacquire, snapshot schema identical to the web client, link budget) plus:
* REST: health, status, start/stop/reset, synchronous step, telemetry and history, config PATCH, presets (including 404), command validation (422 on an unknown command), recording start/stop, CSV and JSON export, batch (3 runs), sensor frame PGM.
* WebSocket `/ws/telemetry`: receives config, then snapshots (JSON) and binary `AQF1` sensor frames; accepts commands.
* Video benchmark: a synthesised 3 s MP4 with ground truth → 90 frames, > 90 % detection, acquisition < 0.5 s, centroid RMSE < 1.5 px, 91-line CSV log.

## 3. Closed-loop performance: Monte-Carlo batch

`python scripts/run_batch.py <preset> 20 15`: 20 random starts per preset (seeds 1000–1019), 15 s each, image-based detector, all disturbances as configured.

| Preset | Locked | Acquisition mean / max | RMS pointing error | Verdict vs PS169 |
|---|---|---|---|---|
| **Open Sky** (default, wide-field acquisition) | 20/20 | **1.13 s / 1.50 s** | **2.97 px** | ✅ acquisition ≤ 2 s, error ≤ 10 px |
| **PS169 Baseline** (4°×3° optics only) | 20/20 | 6.66 s / 12.70 s | 2.78 px | error ✅; acquisition ≤ 2 s only when the beacon starts near the centre (a full raster of 12.5° with a 4° FOV needs about 11 s at 5°/s) |
| Moving Platform | 20/20 | 1.20 s / 1.50 s | 7.02 px | ✅ |
| High Jitter (±20 px/frame) | 20/20 | 1.13 s / 1.47 s | 17.44 px | ✕ error: uniform ±20 px white jitter alone is ≈ 16 px RMS, a physical floor no coarse gimbal can remove (reported honestly) |
| Weak Beacon (haze, dim 6 px spot, σ = 18) | 20/20 | 4.03 s / 9.30 s | 5.14 px | error ✅; acquisition slower (lower per-frame detection probability) |
| Fast Target (1.5°/s random, 10°/s gimbal) | 20/20 | 1.03 s / 2.33 s | 9.79 px | ✅ marginal |
| Acquisition Challenge (corner start, rain, 30 % dropouts, decoy) | 20/20 | 3.88 s / 4.07 s | 3.08 px | error ✅ |
| LEO Pass (550 km, 62°, 2.5 s ephemeris error) | 20/20 | 0.99 s / 1.00 s | 2.86 px | ✅ |

**Wide-field acquisition** (ASTRAQ feature) versus PS-only optics: mean acquisition **1.13 s vs 6.66 s**, max **1.50 s vs 12.70 s**, with the same tracking accuracy.

Loss in all presets was 0 % after first lock over 15 s. Losses are exercised in the demo phase and in the dropout tests.

## 4. Kalman filter and feed-forward ablation
Python engine, circular / sinusoidal / random targets × seeds 1–3, 15 s:

| Configuration | Mean RMS pointing error |
|---|---|
| Kalman (az/el) + rate feed-forward (default) | **3.74 px** |
| Kalman, no feed-forward | 12.80 px |
| No Kalman (raw last measurement) | 14.91 px |

## 5. Video benchmark (camera bypassed)
`python scripts/make_test_video.py bench.mp4 10`, then `POST /api/video/analyze` with the truth CSV:

| Video | Frames | Detection rate | Acquisition | Loss | Centroid RMSE / max | Processing |
|---|---|---|---|---|---|---|
| 640×480 @ 30 fps, σ = 8, mp4v-compressed | 300 | 100 % | 0.033 s | 0 % | **0.045 / 0.13 px** | 58 fps |
| same path, σ = 18 | 300 | 100 % | 0.033 s | 0 % | **0.082 / 0.21 px** | 88 fps |

## 6. UI and 3D verification (headless Chromium, screenshots in `docs/screenshots/`)

| Verified | How | Result |
|---|---|---|
| 3D scene loads | screenshots of all five views | ✅ Earth (real coastlines, twilight atmosphere, city lights, clouds), terminal, satellite, frustum, link, labels |
| Target moves | trail and field map change; `target.u/v` differ between snapshots (unit test) | ✅ |
| Camera projection works | sensor frame spot at the projected pixel (unit test); overlay centroid matches the drawn spot | ✅ |
| Gimbal responds | pan/tilt readouts, dial and 3D yoke/telescope follow; Terminal view shows the telescope aligned with the link | ✅ |
| Tracking state changes | captured SEARCHING→DETECTED→ACQUIRING→TRACKING (wide FOV 10.3°) → LOCKED; demo LOST/REACQUIRING | ✅ |
| Telemetry updates | T+ clock, readouts, sparkline and graphs advance | ✅ |
| Experiment recording | recorder unit test; API export test; UI record/export wired to the same `Recorder` | ✅ |
| Remote engine | UI connected to FastAPI over WebSocket: source chip *FastAPI engine 32 fps*, Python-rendered frames, LOCKED | ✅ |
| Every button does something | tool rail (7 drawers + measure), view switch, run/pause/reset/record/demo/help, sensor calibration/expand, analysis tabs, experiment controls, replay bar, engine connect; YOLO shown **disabled / planned** | ✅ |
| Responsive layout | 1600×900 and 1280×720 | ✅ (HUD measured at runtime; framing adapts) |
| Console errors caused by the app | production build: **none**. The only message is a three.js deprecation *warning* (`THREE.Clock`) raised inside `@react-three/fiber` | ✅ |

Issues found and fixed during validation:
* Atmosphere overexposed from the ground → rewrote it as an Earth-shadow twilight model.
* Point-light intensity wrong in km units → rescaled.
* Sensor-POV camera overridden by disabled orbit controls → the pose is now set directly.
* Integrator windup causing a 6 px bias → added integral separation.
* Search waypoints marked reached too early → tightened tolerance (open-sky acquisition max 6.5 s → 1.5 s).
* Noise blobs confirmed as detections → spatially consistent confirmation and 8-neighbour impulse repair.
* Jitter causing Kalman gate lock-out → adaptive R.
* drei `<Html>` React-root errors under StrictMode → replaced with projected DOM labels.

## 7. Clean-install check of the delivered ZIP
The ZIP was extracted into an empty directory and checked on both sides:
* `cd web && npm install && npm run build && npm test`: install OK (0 vulnerabilities), build OK, **51/51** tests passed.
* `cd server && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && python -m pytest`: install OK, **30/30** tests passed.

## 8. Not tested / limitations
* Real GPUs were not available in the test environment. Rendering was checked with software WebGL, where frame rates are not representative; performance on real hardware is expected to be much higher.
* Browsers other than Chromium were not tested automatically.
* Physical hardware (camera, gimbal) and YOLO are not implemented, so they were not tested.
