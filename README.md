# Spatial Glass UI (WebXR)

A futuristic spatial UI inspired by Apple Vision Pro — floating glass panels
in space, with subtle motion, depth, and real-world object interaction via
the device camera.

The interface combines:

- A live camera feed as the world layer (front camera mirrored by default).
- Real-time object detection (COCO-SSD on TensorFlow.js) with temporal
  hysteresis so focus doesn't strobe between neighbouring objects.
- Per-object silhouette segmentation (MediaPipe Interactive Segmenter) to
  render a soft, monochromatic glow on the actual contour — no bounding
  boxes, no colour wash over the scene.
- An Apple-style "liquid glass" popup anchored near the focused object,
  rendered as a Three.js `MeshPhysicalMaterial` plane with patched shaders
  (rounded SDF corners, edge rim, milky interior lift) composited
  against a transparent DOM popup for typography and interaction.
- A TiltedCard-style hover response on the popup (3D tilt + scale, driven
  by per-frame pointer polling so the DOM content and 3D glass tilt
  together), EMA-smoothed damped following of the focused object, and a
  subtle head-relative parallax offset for a "world-anchored" feel.

## Tech stack

- **Three.js** — scene, camera, renderer, custom shader-patched glass
- **Vite** — dev server + build
- **TensorFlow.js** + **@tensorflow-models/coco-ssd** — object detection
- **@mediapipe/tasks-vision** (`InteractiveSegmenter`) — contour silhouette
- **WebXR** (VRButton) — optional immersive mode

No framework — vanilla JS.

## Getting started

```bash
npm install
npm run dev
```

Open the URL that Vite prints (default `http://localhost:5183`) in a
browser that supports WebXR if you want the VR entry. Camera access is
required; your browser will prompt for permission on first load.

```bash
npm run build
npm run preview
```

## Project structure

```
src/
  core/Experience.js        orchestrator: scene, detection, focus, popup glue
  camera/CameraInputLayer   camera → Three.js plane (background)
  sources/CameraVideoSource getUserMedia abstraction (RTMP-swappable)
  detection/
    ObjectDetector          COCO-SSD + hysteresis + focus scoring
    InteractiveSegmenter    MediaPipe silhouette mask (throttled)
    labels.zh.js            Chinese label map for COCO classes
  focus/
    FocusHighlightLayer     soft-glow contour shader fed by the mask
    FluidGlassPanel         Apple-style liquid-glass 3D panel
    SpatialFocusUI          transparent DOM popup, sticky pin, parallax
  scene/                    lighting / environment
  ui/
    StatusBadge             top-left init / error readout
    DetectionOverlay        dev-only dashed bbox overlay (toggle: D)
  utils/damp.js             framerate-independent lerp helper
  main.js                   entry point
  spatial.css               shared design tokens + popup CSS
public/mediapipe/           self-hosted WASM runtime + segmenter model
index.html                  spatial UI entry
vite.config.js              Vite config (spatial-only)
spec.md                     design spec / notes
```

## Dev shortcuts

- `D` — toggle the raw detection bbox overlay (debug)
- `M` — toggle horizontal camera mirroring

## Design notes

See [`spec.md`](./spec.md) for the full spec covering the glass aesthetic,
parallax, idle/breathing motion, focus logic, highlight system, popup
behaviour and interaction rules.
