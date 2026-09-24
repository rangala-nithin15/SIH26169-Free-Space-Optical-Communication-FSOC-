# ASTRAQ — Run Guide

## Fastest start (no backend)

```bash
# Terminal 1
cd ASTRAQ/web
npm install        # first time only
npm run dev
```
Open **http://localhost:5173**. That is all you need for the full demo.

On Windows you can instead double-click `start-web.bat`. On macOS/Linux run `./start-web.sh`.

## With the Python engine (optional)

```bash
# Terminal 2
cd ASTRAQ/server
python -m venv .venv
.venv\Scripts\activate           # Windows  |  macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt  # first time only
python -m uvicorn app.main:app --reload --port 8000
```
Then in the browser open **Experiment** (flask icon on the left) ▸ **Engine** ▸ **FastAPI server** ▸ **Connect**. API docs are at http://localhost:8000/docs.

Command-line extras (Terminal 2, venv active):
```bash
python scripts/run_batch.py open-sky 20 15      # Monte-Carlo: preset, runs, seconds
python scripts/make_test_video.py test.mp4 8    # benchmark video + test_truth.csv
curl -F file=@test.mp4 -F truth=@test_truth.csv http://localhost:8000/api/video/analyze
```

## 3-minute judge demonstration

| When | Do | Say |
|---|---|---|
| 0:00 | Page is open in **Overview** | "A mobile optical ground terminal must point its laser link at a satellite. Before the fine laser stage can work, a camera has to find the satellite's beacon and steer the gimbal onto it. That is coarse alignment, and it is what ASTRAQ simulates." |
| 0:20 | Press **R** (reset) and watch the state badge | "The beacon starts at a random point in a 12.5° search field. The camera scans wide (12°), **detects**, zooms to 4° and **locks** in about a second and a half. The mission timeline records each stage." |
| 0:45 | Point at the **sensor panel** | "This is the actual 640×480 image the detector processes: noise, stars, the beacon. The box is the detection, the cross is the centroid, the dashed line is the error from the image centre, and the diamond is the Kalman prediction." |
| 1:05 | Point along the **alignment chain** | "Here is the loop: error → detection → estimate → PID pan/tilt command → gimbal motion → pixel error, which stays under the 10-pixel lock threshold." |
| 1:20 | Press **2** (Terminal view) | "Here is the terminal: a levelled truck, telescopic mast, and a pan-over-tilt gimbal carrying the telescope and acquisition camera. It is moving right now." |
| 1:35 | Press **D** (demo) | "The scripted demo cycles through motion types and then fog with 60 % beacon dropouts. The tracker coasts on its prediction, goes LOST, searches locally and reacquires." |
| 2:15 | Press **A** (analysis) | "Live graphs, plus the PS169 acceptance card: acquisition ≤ 2 s, error ≤ 10 px, loss < 5 %, re-acquisition ≤ 1 s, ≥ 20 FPS, all measured against ground truth." |
| 2:35 | Press **4** (Sensor POV), then **5** (Orbit) | "Through the telescope, and the geometry from orbit. Coastlines are real data, and distances and directions are true." |
| 2:50 | Open **Experiment** | "Every run can be recorded, exported to CSV or JSON, replayed, or batch-tested over many random starts. The same engine also runs in Python behind a FastAPI WebSocket, including an MP4 benchmark that bypasses the camera." |

## Keyboard

`Space` run/pause · `R` reset · `D` demo · `1–5` views · `S` sensor · `A` analysis · `M` manual gimbal (arrows jog) · `?` help · `Esc` close

## If something goes wrong

See **README §18 Troubleshooting**. The two most common problems: `npm` is not found (install Node.js 20+, then reopen the terminal), and a black 3D view (wait 5 s, or choose View ▸ Quality ▸ Low, or enable browser hardware acceleration).
