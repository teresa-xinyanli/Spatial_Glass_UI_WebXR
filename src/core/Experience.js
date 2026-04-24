import {
  ACESFilmicToneMapping,
  AmbientLight,
  Clock,
  DirectionalLight,
  PerspectiveCamera,
  PMREMGenerator,
  Raycaster,
  Scene,
  Vector2,
  WebGLRenderer
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';

import { damp } from '../utils/damp.js';
import { CameraVideoSource } from '../sources/CameraVideoSource.js';
import { CameraInputLayer } from '../camera/CameraInputLayer.js';
import { ObjectDetector } from '../detection/ObjectDetector.js';
import { InteractiveSegmenter } from '../detection/InteractiveSegmenter.js';
import { toChineseLabel } from '../detection/labels.zh.js';
import { FocusHighlightLayer } from '../focus/FocusHighlightLayer.js';
import { FluidGlassPanel } from '../focus/FluidGlassPanel.js';
import { SpatialFocusUI } from '../focus/SpatialFocusUI.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { DetectionOverlay } from '../ui/DetectionOverlay.js';

const SCREEN_CENTER = { x: 0.5, y: 0.5 };
const POINTER_NDC = new Vector2();

// Tracking hysteresis: a previously-focused detection gets a (1 - bonus)
// distance multiplier when scoring against the screen center, making it
// "stickier" so two close objects don't strobe the focus back and forth.
const FOCUS_TRACK_IOU_THRESHOLD = 0.3;
const FOCUS_TRACK_BONUS = 0.4;

const SEGMENTATION_INTERVAL_MS = 140;

function intersectionOverUnion(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) {
    return 0;
  }
  const inter = (x2 - x1) * (y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

export class Experience {
  constructor(container) {
    this.container = container;
    this.clock = new Clock();
    this.scene = new Scene();

    this.pointer = new Vector2();
    this.pointerTarget = new Vector2();
    this.videoRaycaster = new Raycaster();

    this.isXRPresenting = false;

    this.latestDetections = [];
    this.focusedDetection = null;
    this.previousFocusedDetection = null;
    this.focusSource = 'center';
    // Snapshot of the focused object at the moment the popup most recently
    // became visible. While the pointer is inside (or just outside) the
    // pinned object's bbox OR on top of the popup, we keep surfacing this
    // snapshot instead of the live detection -- that way brief bbox
    // jitter won't kick source back to 'center' and strobe the popup.
    this.popupPinnedObject = null;

    // Low-pass filter state for the focused object's screen-space bbox.
    // The detector emits fresh coordinates ~10 Hz and small objects jitter
    // 3-10 px per frame from model noise alone. Feeding those raw numbers
    // into the popup's damp() just smears the noise into continuous drift,
    // so we EMA-smooth them here before anything downstream sees them.
    // Reset whenever the focused object's identity (label + rough screen
    // location) changes, so real focus switches snap instantly.
    this.smoothedObjectBox = null;
    this.smoothedObjectLabel = null;
    this.pointerClient = {
      x: window.innerWidth * 0.5,
      y: window.innerHeight * 0.5
    };
    this.videoPointerUv = { x: 0.5, y: 0.5 };
    this.hasPointerInput = false;
    this.hasVideoPointerInput = false;

    this.objectDetector = null;
    this.segmenter = null;
    this.lastSegmentationTime = 0;
    this.detectionStatus = 'idle';

    this.camera = new PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 0, 0.4);
    this.scene.add(this.camera);

    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;

    this.container.appendChild(this.renderer.domElement);

    this.statusBadge = new StatusBadge();
    this.statusBadge.set('loading', 'starting...', 'STATUS');

    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.videoSource = new CameraVideoSource({ facingMode: 'user' });
    this.cameraInputLayer = new CameraInputLayer(this.camera, this.videoSource, {
      mirror: this.videoSource.shouldMirrorByDefault
    });
    this.cameraInputLayer.fitToCamera(this.camera);

    this.focusHighlightLayer = new FocusHighlightLayer();
    this.focusHighlightLayer.attachTo(this.cameraInputLayer.getSurface());

    this.fluidGlassPanel = new FluidGlassPanel();
    this.fluidGlassPanel.attachTo(this.camera);

    // Small circular lens that acts as the cursor itself (React Bits' lens
    // mode vibe). Distance pulled slightly closer so when it crosses the
    // popup's larger panel it reads as "lens sitting on top of glass".
    // Thickness is tuned so its small radius still produces a visible
    // refraction dip at the edge, without going blue/dark.
    this.cursorLens = new FluidGlassPanel({
      distance: 2.6,
      cornerMode: 'circle',
      ior: 1.5,
      thickness: 0.22,
      roughness: 0.04,
      edgeWidthPx: 3.2,
      edgeStrength: 0.75,
      milkyLift: 0.06
    });
    this.cursorLens.attachTo(this.camera);
    this.cursorLensSize = 46;

    this.detectionOverlay = new DetectionOverlay();
    this.detectionOverlay.setMirror(this.cameraInputLayer.mirror);

    this.focusUI = new SpatialFocusUI({
      onAction: this.handlePopupAction
    });

    this.setupLights();
    this.setupEvents();
    this.setupXR();
    this.initializeCameraAndDetection();

    this.renderer.setAnimationLoop(() => this.update());
  }

  setupLights() {
    const ambientLight = new AmbientLight('#dff0ff', 1.8);
    const keyLight = new DirectionalLight('#9ad3ff', 1.35);
    keyLight.position.set(1.8, 2.4, 2.2);

    this.scene.add(ambientLight);
    this.scene.add(keyLight);
  }

  setupEvents() {
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('pointermove', this.handlePointerMove, { passive: true });
    window.addEventListener('pointerleave', this.handlePointerLeave);
    window.addEventListener('beforeunload', this.handleBeforeUnload);
    window.addEventListener('keydown', this.handleKeyDown);
    this.renderer.xr.addEventListener('sessionstart', () => {
      this.isXRPresenting = true;
    });
    this.renderer.xr.addEventListener('sessionend', () => {
      this.isXRPresenting = false;
    });
  }

  setupXR() {
    if (!navigator.xr) {
      return;
    }

    const button = VRButton.createButton(this.renderer);
    button.classList.add('vr-button');
    document.body.appendChild(button);
  }

  handleResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.cameraInputLayer.fitToCamera(this.camera);
  };

  handlePointerMove = (event) => {
    const normalizedX = (event.clientX / window.innerWidth) * 2 - 1;
    const normalizedY = (event.clientY / window.innerHeight) * 2 - 1;

    this.pointerTarget.set(normalizedX, normalizedY);
    this.pointerClient.x = event.clientX;
    this.pointerClient.y = event.clientY;
    this.hasPointerInput = true;
    this.updateVideoPointerFromScreen(event.clientX, event.clientY);
  };

  handlePointerLeave = () => {
    this.pointerTarget.set(0, 0);
    this.hasPointerInput = false;
    this.hasVideoPointerInput = false;
  };

  handleBeforeUnload = () => {
    this.objectDetector?.stop();
    this.segmenter?.dispose();
    this.focusHighlightLayer.dispose();
    this.fluidGlassPanel?.dispose();
    this.cursorLens?.dispose();
    this.focusUI.dispose();
    this.detectionOverlay?.dispose();
    this.cameraInputLayer.dispose();
    this.statusBadge?.dispose();
  };

  handleKeyDown = (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }
    if (event.key === 'd' || event.key === 'D') {
      const visible = this.detectionOverlay.toggle();
      this.statusBadge.set('ready', visible ? 'on' : 'off', 'BBOX OVERLAY');
    }
    if (event.key === 'm' || event.key === 'M') {
      this.cameraInputLayer.setMirror(!this.cameraInputLayer.mirror);
      this.detectionOverlay.setMirror(this.cameraInputLayer.mirror);
      this.statusBadge.set('ready', this.cameraInputLayer.mirror ? 'on' : 'off', 'MIRROR');
    }
  };

  handlePopupAction = (payload) => {
    window.dispatchEvent(
      new CustomEvent('attrax:popup-action', {
        detail: payload
      })
    );
    this.statusBadge.set('ready', `action · ${payload.action}`);
  };

  handleDetections = (detections) => {
    const enriched = detections.map((d) => ({ ...d, labelZh: toChineseLabel(d.label) }));
    this.latestDetections = enriched;
    const focusResult = this.selectFocusObject(enriched);

    this.focusedDetection = focusResult.detection;
    this.focusSource = focusResult.source;
    if (this.focusedDetection) {
      this.previousFocusedDetection = this.focusedDetection;
    }

    this.detectionOverlay?.setDetections(enriched, this.focusedDetection);

    const summary = enriched.length
      ? `${enriched.length} object${enriched.length > 1 ? 's' : ''}`
      : 'no objects';
    this.statusBadge.set('ready', summary, 'DETECTOR');

    window.dispatchEvent(
      new CustomEvent('attrax:detections', {
        detail: enriched
      })
    );

    window.dispatchEvent(
      new CustomEvent('attrax:focus', {
        detail: this.getFocusedObject()
      })
    );
  };

  handleDetectionStatus = (status) => {
    const phaseToState = {
      loading: 'loading',
      ready: 'ready',
      running: 'ready',
      error: 'error'
    };
    this.statusBadge.set(phaseToState[status.phase] || 'idle', status.message, 'DETECTOR');
  };

  handleSegmenterStatus = (status) => {
    if (status.phase === 'ready') {
      return;
    }
    this.statusBadge.set('loading', status.message, 'SEGMENTER');
  };

  selectFocusObject(detections) {
    if (!detections.length) {
      return { detection: null, source: 'none' };
    }

    let trackedDetection = null;
    let trackedIou = 0;
    if (this.previousFocusedDetection) {
      for (const detection of detections) {
        if (detection.label !== this.previousFocusedDetection.label) {
          continue;
        }
        const iou = intersectionOverUnion(
          detection.normalizedBBox,
          this.previousFocusedDetection.normalizedBBox
        );
        if (iou > FOCUS_TRACK_IOU_THRESHOLD && iou > trackedIou) {
          trackedIou = iou;
          trackedDetection = detection;
        }
      }
    }

    if (this.hasVideoPointerInput) {
      const hovered = this.pickByMousePosition(detections, this.videoPointerUv);
      if (hovered) {
        return { detection: hovered, source: 'mouse' };
      }
    }

    let selected = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const detection of detections) {
      const dx = detection.normalizedCenter.x - SCREEN_CENTER.x;
      const dy = detection.normalizedCenter.y - SCREEN_CENTER.y;
      let distance = dx * dx + dy * dy;
      if (detection === trackedDetection) {
        distance *= 1 - FOCUS_TRACK_BONUS;
      }
      if (distance < bestDistance) {
        bestDistance = distance;
        selected = detection;
      }
    }

    return { detection: selected, source: 'center' };
  }

  updateVideoPointerFromScreen(clientX, clientY) {
    const surface = this.cameraInputLayer.getSurface();
    if (!surface) {
      this.hasVideoPointerInput = false;
      return;
    }

    POINTER_NDC.x = (clientX / window.innerWidth) * 2 - 1;
    POINTER_NDC.y = -(clientY / window.innerHeight) * 2 + 1;

    this.camera.updateMatrixWorld(true);
    this.videoRaycaster.setFromCamera(POINTER_NDC, this.camera);
    const intersections = this.videoRaycaster.intersectObject(surface, false);

    if (!intersections.length || !intersections[0].uv) {
      this.hasVideoPointerInput = false;
      return;
    }

    // UV is intrinsic to the geometry, so even when the parent frame group
    // mirrors the surface (scale.x = -1) the UV here is in the original
    // image-space -- which is exactly what the detector + segmenter expect.
    const uv = intersections[0].uv;
    this.videoPointerUv.x = uv.x;
    this.videoPointerUv.y = 1 - uv.y;
    this.hasVideoPointerInput = true;
  }

  pickByMousePosition(detections, point) {
    const matched = detections.filter((detection) => {
      const bbox = detection.normalizedBBox;
      return (
        point.x >= bbox.x
        && point.x <= bbox.x + bbox.width
        && point.y >= bbox.y
        && point.y <= bbox.y + bbox.height
      );
    });

    if (!matched.length) {
      return null;
    }

    matched.sort((a, b) => b.score - a.score);
    return matched[0];
  }

  getFocusedObject() {
    if (!this.focusedDetection) {
      return null;
    }

    return {
      source: this.focusSource,
      label: this.focusedDetection.label,
      labelZh: toChineseLabel(this.focusedDetection.label),
      score: this.focusedDetection.score,
      bbox: this.focusedDetection.bbox,
      normalizedBBox: this.focusedDetection.normalizedBBox,
      center: this.focusedDetection.center,
      normalizedCenter: this.focusedDetection.normalizedCenter
    };
  }

  /**
   * Translates the focused object's normalized bbox into the object's screen
   * center + half-size, accounting for the display mirror. The popup uses
   * this to place itself with edge-avoidance and to draw a connector back.
   */
  computeObjectScreenBox(focusedObject) {
    if (!focusedObject) {
      return null;
    }
    const bbox = focusedObject.normalizedBBox;
    const mirror = this.cameraInputLayer.mirror;
    const W = window.innerWidth;
    const H = window.innerHeight;

    const dispLeft = mirror ? 1 - bbox.x - bbox.width : bbox.x;
    const centerX = (dispLeft + bbox.width * 0.5) * W;
    const centerY = (bbox.y + bbox.height * 0.5) * H;

    return {
      x: centerX,
      y: centerY,
      halfW: bbox.width * W * 0.5,
      halfH: bbox.height * H * 0.5
    };
  }

  /**
   * Is the user's screen-space pointer still inside (or just outside, by
   * paddingPx on each side) the currently pinned object's bbox? Used to
   * keep the popup visible through detection jitter at the object's edge.
   */
  isPointerNearPinnedBbox(paddingPx) {
    if (!this.popupPinnedObject || !this.hasPointerInput) return false;
    const box = this.computeObjectScreenBox(this.popupPinnedObject);
    if (!box) return false;
    return (
      this.pointerClient.x >= box.x - box.halfW - paddingPx
      && this.pointerClient.x <= box.x + box.halfW + paddingPx
      && this.pointerClient.y >= box.y - box.halfH - paddingPx
      && this.pointerClient.y <= box.y + box.halfH + paddingPx
    );
  }

  /**
   * Heuristic: are two focused-object snapshots likely the *same* physical
   * instance in the scene? The detector doesn't give us stable track IDs,
   * so we approximate tracking by comparing label + normalized bbox center
   * proximity. A generous threshold (12% of the normalized viewport, i.e.
   * ~23% of a shorter dimension in pixels) covers the drift of a single
   * object between detection frames while still separating two distinct
   * instances of the same class (two people, two cups) that are clearly
   * apart on screen.
   */
  isSamePhysicalObject(a, b) {
    if (!a || !b) return false;
    if (a.label !== b.label) return false;
    const ba = a.normalizedBBox;
    const bb = b.normalizedBBox;
    if (!ba || !bb) return false;
    const ca = { x: ba.x + ba.width * 0.5, y: ba.y + ba.height * 0.5 };
    const cb = { x: bb.x + bb.width * 0.5, y: bb.y + bb.height * 0.5 };
    const dx = ca.x - cb.x;
    const dy = ca.y - cb.y;
    return (dx * dx + dy * dy) < 0.12 * 0.12;
  }

  /**
   * Low-pass filter the focused object's screen-space bbox. Raw detections
   * arrive at ~10 Hz with a few pixels of per-frame noise even for a
   * completely static scene; passing that noise through to the popup's
   * positioner makes the panel visibly drift. We EMA-smooth the center
   * and half-sizes at a moderate lambda (~5 Hz cutoff), and hard-reset
   * whenever the focused object's identity changes so genuine focus
   * switches snap instantly instead of melting into the old position.
   */
  getSmoothedObjectBox(focusedObject, rawBox, deltaTime) {
    if (!focusedObject || !rawBox) {
      this.smoothedObjectBox = null;
      this.smoothedObjectLabel = null;
      return null;
    }

    const W = window.innerWidth;
    const H = window.innerHeight;
    const RESET_THRESHOLD = Math.min(W, H) * 0.25;

    const sameIdentity =
      this.smoothedObjectBox
      && this.smoothedObjectLabel === focusedObject.label
      && Math.abs(rawBox.x - this.smoothedObjectBox.x) < RESET_THRESHOLD
      && Math.abs(rawBox.y - this.smoothedObjectBox.y) < RESET_THRESHOLD;

    if (!sameIdentity) {
      this.smoothedObjectBox = { ...rawBox };
      this.smoothedObjectLabel = focusedObject.label;
      return this.smoothedObjectBox;
    }

    // lambda=4 → ~250 ms time constant. Intentionally a hair slower than
    // "snap-to-detection" so the popup visibly trails the object by a
    // frame or two (the "damped following / soft feel" from the spec)
    // while still converging well within a user-perceptible beat.
    const k = 1 - Math.exp(-4 * deltaTime);
    this.smoothedObjectBox.x += (rawBox.x - this.smoothedObjectBox.x) * k;
    this.smoothedObjectBox.y += (rawBox.y - this.smoothedObjectBox.y) * k;
    this.smoothedObjectBox.halfW += (rawBox.halfW - this.smoothedObjectBox.halfW) * k;
    this.smoothedObjectBox.halfH += (rawBox.halfH - this.smoothedObjectBox.halfH) * k;
    return this.smoothedObjectBox;
  }

  /**
   * Small screen-space offset applied to the popup so it reads as
   * world-anchored when the camera rotates. Opposite sign to the camera's
   * Euler because a world-fixed point shifts against the rotation as seen
   * from the view. Capped well under 5% of the viewport per spec.
   *
   * Only active in real WebXR sessions. In desktop mode camera.rotation is
   * driven by the mouse (updateDesktopCamera) -- so coupling parallax to
   * it means every mouse move to click a popup button also drifts the
   * popup, which reads as "the popup is jittering" rather than "my head
   * moves so the world-anchored popup parallaxes". When the same pointer
   * that selects objects also controls the camera, the illusion breaks,
   * so we disable parallax outside of XR entirely.
   */
  computePopupParallaxOffset() {
    if (!this.renderer.xr?.isPresenting) {
      return { x: 0, y: 0 };
    }

    const minDim = Math.min(window.innerWidth, window.innerHeight);
    const maxPx = minDim * 0.04; // spec: <5%, we cap at 4%
    const pxPerRad = minDim * 0.9;

    const rawX = -this.camera.rotation.y * pxPerRad;
    const rawY = this.camera.rotation.x * pxPerRad;

    return {
      x: Math.max(-maxPx, Math.min(maxPx, rawX)),
      y: Math.max(-maxPx, Math.min(maxPx, rawY))
    };
  }

  async initializeCameraAndDetection() {
    const cameraReady = await this.cameraInputLayer.initialize();
    if (!cameraReady) {
      this.statusBadge.set('error', 'camera permission denied', 'CAMERA');
      return;
    }
    this.statusBadge.set('ready', 'camera live', 'CAMERA');

    try {
      this.objectDetector = new ObjectDetector({
        minScore: 0.4,
        maxBoxes: 8,
        intervalMs: 120,
        onDetections: this.handleDetections,
        onStatus: this.handleDetectionStatus
      });

      await this.objectDetector.initialize();
      this.objectDetector.start(this.cameraInputLayer.getVideoElement());
    } catch (error) {
      console.error('Detector initialization failed:', error);
      this.statusBadge.set('error', 'detector init failed', 'DETECTOR');
    }

    try {
      this.segmenter = new InteractiveSegmenter({
        onStatus: this.handleSegmenterStatus
      });
      await this.segmenter.initialize();
      this.statusBadge.set('ready', 'segmenter live', 'SEGMENTER');
    } catch (error) {
      console.error('Segmenter initialization failed:', error);
      this.statusBadge.set('error', 'segmenter init failed', 'SEGMENTER');
      this.segmenter = null;
    }
  }

  maybeRunSegmentation(nowMs) {
    if (!this.segmenter?.ready || !this.cameraInputLayer.isReady) {
      return;
    }
    if (!this.focusedDetection) {
      return;
    }
    if (nowMs - this.lastSegmentationTime < SEGMENTATION_INTERVAL_MS) {
      return;
    }
    this.lastSegmentationTime = nowMs;

    const point = this.focusedDetection.normalizedCenter;
    const result = this.segmenter.segment(
      this.cameraInputLayer.getVideoElement(),
      point
    );
    if (result) {
      this.focusHighlightLayer.setMask(result);
    }
  }

  /**
   * Fades out the highlight the instant nothing is focused anymore. Real
   * segmentation masks are pushed in via maybeRunSegmentation; when none
   * arrive we simply don't paint anything -- the user's rule is "the outline
   * must correspond to the actual object, no color overlays".
   */
  updateHighlightMask() {
    if (!this.focusedDetection) {
      this.focusHighlightLayer.setMask(null);
    }
  }

  updateDesktopCamera(deltaTime) {
    this.pointer.lerp(this.pointerTarget, 1 - Math.exp(-4.5 * deltaTime));
    this.camera.position.x = damp(this.camera.position.x, this.pointer.x * 0.04, 3.8, deltaTime);
    this.camera.position.y = damp(this.camera.position.y, this.pointer.y * -0.03, 3.8, deltaTime);
    this.camera.rotation.y = damp(this.camera.rotation.y, this.pointer.x * -0.03, 4.2, deltaTime);
    this.camera.rotation.x = damp(this.camera.rotation.x, this.pointer.y * -0.02, 4.2, deltaTime);
  }

  update() {
    const deltaTime = Math.min(this.clock.getDelta(), 0.1);
    const elapsedTime = this.clock.getElapsedTime();
    const nowMs = performance.now();

    if (!this.isXRPresenting) {
      this.updateDesktopCamera(deltaTime);
      if (this.hasPointerInput) {
        this.updateVideoPointerFromScreen(this.pointerClient.x, this.pointerClient.y);
      }
    }

    this.maybeRunSegmentation(nowMs);
    this.updateHighlightMask(nowMs);
    this.focusHighlightLayer.update(elapsedTime, deltaTime);

    // Sticky popup: the live focus flips from source='mouse' back to
    // 'center' the moment the cursor strays outside the bbox -- and bbox
    // noise alone is enough to push the cursor out for single frames at
    // the edge. Widen the "what counts as still hovering" region so the
    // popup doesn't strobe while the user is clearly still on the object.
    const liveFocus = this.getFocusedObject();
    const pointerOverPopup =
      this.hasPointerInput
      && this.focusUI.isPointInPopup(
        this.pointerClient.x,
        this.pointerClient.y
      );

    if (liveFocus && liveFocus.source === 'mouse') {
      // Fresh, unambiguous hover over an object: this is the new pin.
      this.popupPinnedObject = liveFocus;
    } else if (
      this.popupPinnedObject
      && liveFocus
      && liveFocus.label === this.popupPinnedObject.label
      && this.isSamePhysicalObject(liveFocus, this.popupPinnedObject)
    ) {
      // Cursor drifted off the bbox (onto the popup, or into the small
      // padding band around the object) but the detector is still tracking
      // the *same* physical instance. Refresh the snapshot so the popup
      // follows the object through its normal damped path instead of
      // freezing at whatever bbox we happened to capture when hover began.
      // Without this, dragging the cursor onto the popup effectively locks
      // the panel in world space even if the object moves.
      this.popupPinnedObject = liveFocus;
    }

    const pointerNearPinned = this.isPointerNearPinnedBbox(24);

    let focusedObject;
    if (liveFocus && liveFocus.source === 'mouse') {
      focusedObject = liveFocus;
    } else if (
      this.popupPinnedObject
      && (pointerOverPopup || pointerNearPinned)
    ) {
      // Brief bbox jitter, or pointer on the popup card -- keep showing
      // the pinned snapshot instead of collapsing back to 'center'.
      focusedObject = this.popupPinnedObject;
    } else {
      // Pointer truly left the region around both the object and its popup.
      focusedObject = liveFocus;
      this.popupPinnedObject = null;
    }

    const rawObjectBox = this.computeObjectScreenBox(focusedObject);
    const objectBox = this.getSmoothedObjectBox(
      focusedObject,
      rawObjectBox,
      deltaTime
    );
    const showPopup = Boolean(
      focusedObject
      && (
        focusedObject.source === 'mouse'
        || pointerOverPopup
        || pointerNearPinned
      )
    );

    // Head-relative parallax: when the camera rotates (driven by mouse in
    // desktop mode and by head pose in XR) we want the popup to FEEL like
    // it's anchored in the world in front of the object, not rigidly glued
    // to the camera. World-anchored elements shift on screen *opposite* to
    // the camera's rotation; here we reproduce that shift as a small 2D
    // offset applied to the popup's rendered position only -- the object
    // itself is on the camera-attached video plane, so its bbox (and thus
    // the ping + connector) is left untouched. Amplitude is hard-capped at
    // 4% of the shorter viewport dimension to stay subtle (<5% per spec).
    const parallaxOffset = this.computePopupParallaxOffset();

    this.focusUI.update({
      focusedObject,
      popupAnchor: objectBox ? { x: objectBox.x, y: objectBox.y } : null,
      bboxSize: objectBox ? { halfW: objectBox.halfW, halfH: objectBox.halfH } : null,
      parallaxOffset,
      showPopup,
      elapsedTime,
      deltaTime
    });

    // Drive the 3D fluid-glass panel from the popup's screen rect so its
    // refraction sits exactly behind the DOM text content. The popup's
    // live rotX/rotY (CSS-space TiltedCard angles) are forwarded so the
    // glass tilts in lock-step with the DOM card, producing a refraction
    // slide that matches the 3D-rotated content above it.
    const popupRect = this.focusUI.getPopupScreenRect();
    if (popupRect) {
      this.fluidGlassPanel.setScreenRect(
        popupRect,
        window.innerWidth,
        window.innerHeight
      );
      this.fluidGlassPanel.setOpacity(popupRect.opacity);
      this.fluidGlassPanel.setRotation(popupRect.rotX, popupRect.rotY);
    } else {
      this.fluidGlassPanel.setOpacity(0);
      this.fluidGlassPanel.setRotation(0, 0);
    }
    this.fluidGlassPanel.update(deltaTime);

    // Cursor lens: a small circle that IS the cursor. Hidden in XR (there's
    // no 2D pointer in immersive sessions) and when the pointer has left the
    // window. When pointing at the focused bbox we nudge it a touch larger
    // so it feels like an affordance.
    const cursorVisible =
      this.hasPointerInput && !this.isXRPresenting;
    if (cursorVisible) {
      const hoveringObject = Boolean(
        focusedObject && focusedObject.source === 'mouse'
      );
      const size = hoveringObject
        ? this.cursorLensSize * 1.25
        : this.cursorLensSize;
      this.cursorLens.setScreenRect(
        {
          x: this.pointerClient.x - size / 2,
          y: this.pointerClient.y - size / 2,
          width: size,
          height: size
        },
        window.innerWidth,
        window.innerHeight
      );
      this.cursorLens.setOpacity(1);
    } else {
      this.cursorLens.setOpacity(0);
    }
    this.cursorLens.update(deltaTime);

    this.renderer.render(this.scene, this.camera);
  }
}
