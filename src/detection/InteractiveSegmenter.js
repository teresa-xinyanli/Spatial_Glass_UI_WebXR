import {
  FilesetResolver,
  InteractiveSegmenter as MPInteractiveSegmenter
} from '@mediapipe/tasks-vision';

// Self-hosted paths: we copy the wasm runtime out of node_modules and bundle
// the magic_touch.tflite model into /public so nothing here depends on Google
// CDNs being reachable. CDN URLs are kept as env-overridable escape hatches.
const DEFAULT_WASM_PATH = '/mediapipe/wasm';

/**
 * "Magic Touch" model: lightweight interactive segmenter that takes a single
 * normalized keypoint and returns the silhouette of the object the point
 * landed on. Hosted locally under /public/mediapipe/models.
 */
const DEFAULT_MODEL_PATH = '/mediapipe/models/magic_touch.tflite';

/**
 * Thin wrapper around MediaPipe's InteractiveSegmenter that exposes a
 * synchronous "give me the mask of the object under this point" API and
 * returns plain typed-array masks the renderer can own across frames.
 */
export class InteractiveSegmenter {
  constructor({
    wasmPath = DEFAULT_WASM_PATH,
    modelPath = DEFAULT_MODEL_PATH,
    delegate = 'GPU',
    onStatus = () => {}
  } = {}) {
    this.wasmPath = wasmPath;
    this.modelPath = modelPath;
    this.delegate = delegate;
    this.onStatus = onStatus;

    this.segmenter = null;
    this.busy = false;
    this.ready = false;
  }

  async initialize() {
    this.onStatus({ phase: 'loading', message: 'Loading segmenter wasm...' });
    const fileset = await FilesetResolver.forVisionTasks(this.wasmPath);

    this.onStatus({ phase: 'loading', message: 'Loading magic_touch model...' });
    this.segmenter = await MPInteractiveSegmenter.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: this.modelPath,
        delegate: this.delegate
      },
      outputCategoryMask: true,
      outputConfidenceMasks: false
    });

    this.ready = true;
    this.onStatus({ phase: 'ready', message: 'Segmenter ready' });
  }

  /**
   * Synchronously segments the object under the given normalized point.
   * Returns { data: Uint8Array, width, height } on success, or null on
   * failure / when the segmenter is busy or not ready. The returned data is
   * owned by the caller and may be retained across frames.
   */
  segment(image, normalizedPoint) {
    if (!this.ready || this.busy) {
      return null;
    }

    this.busy = true;
    let mask = null;
    let result = null;

    try {
      result = this.segmenter.segment(image, { keypoint: normalizedPoint });
      mask = result?.categoryMask;
      if (!mask) {
        return null;
      }

      const source = mask.getAsUint8Array();
      const owned = new Uint8Array(source.length);
      owned.set(source);

      return { data: owned, width: mask.width, height: mask.height };
    } catch (error) {
      console.error('InteractiveSegmenter.segment failed:', error);
      return null;
    } finally {
      try { mask?.close(); } catch { /* noop */ }
      this.busy = false;
    }
  }

  dispose() {
    if (this.segmenter) {
      try { this.segmenter.close(); } catch { /* noop */ }
      this.segmenter = null;
    }
    this.ready = false;
  }
}
