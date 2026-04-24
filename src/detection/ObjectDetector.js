import * as cocoSsd from '@tensorflow-models/coco-ssd';
import * as tf from '@tensorflow/tfjs';

/**
 * @typedef {object} ClassFilter
 * @property {string[]} [include] only emit detections whose label is in this list
 * @property {string[]} [exclude] drop detections whose label is in this list
 */

export class ObjectDetector {
  constructor({
    minScore = 0.5,
    maxBoxes = 8,
    intervalMs = 160,
    classFilter = null,
    onDetections = () => {},
    onStatus = () => {}
  } = {}) {
    this.model = null;
    this.videoElement = null;
    this.onDetections = onDetections;
    this.onStatus = onStatus;
    this.minScore = minScore;
    this.maxBoxes = maxBoxes;
    this.intervalMs = intervalMs;
    this.classFilter = classFilter;

    this.running = false;
    this.lastDetectionTime = 0;
    this.rafId = null;
    this.isInferenceRunning = false;
  }

  setClassFilter(classFilter) {
    this.classFilter = classFilter;
  }

  passesClassFilter(label) {
    const filter = this.classFilter;
    if (!filter) {
      return true;
    }
    if (filter.include && !filter.include.includes(label)) {
      return false;
    }
    if (filter.exclude && filter.exclude.includes(label)) {
      return false;
    }
    return true;
  }

  async initialize() {
    this.onStatus({ phase: 'loading', message: 'Initializing TensorFlow.js...' });
    await tf.ready();

    let backend = tf.getBackend();

    try {
      if (backend !== 'webgl') {
        await tf.setBackend('webgl');
        backend = 'webgl';
      }
    } catch (error) {
      console.warn('WebGL backend failed, falling back to CPU backend.', error);
      await tf.setBackend('cpu');
      backend = 'cpu';
    }

    this.onStatus({ phase: 'loading', message: `Loading COCO-SSD model (${backend})...` });
    this.model = await cocoSsd.load({
      base: 'mobilenet_v2'
    });
    this.onStatus({ phase: 'ready', message: `Detector ready (${backend})` });
  }

  start(videoElement) {
    if (!this.model) {
      throw new Error('ObjectDetector must be initialized before start().');
    }

    this.videoElement = videoElement;
    this.running = true;
    this.lastDetectionTime = 0;
    this.onStatus({ phase: 'running', message: 'Detection running' });
    this.loop();
  }

  stop() {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  loop = async (time = 0) => {
    if (!this.running) {
      return;
    }

    this.rafId = requestAnimationFrame(this.loop);

    if (this.isInferenceRunning) {
      return;
    }

    if (time - this.lastDetectionTime < this.intervalMs) {
      return;
    }

    if (!this.videoElement || this.videoElement.readyState < 2) {
      return;
    }

    this.lastDetectionTime = time;
    this.isInferenceRunning = true;

    try {
      const predictions = await this.model.detect(this.videoElement, this.maxBoxes);
      const width = this.videoElement.videoWidth || 1;
      const height = this.videoElement.videoHeight || 1;

      const detections = predictions
        .filter((prediction) => prediction.score >= this.minScore)
        .filter((prediction) => this.passesClassFilter(prediction.class))
        .map((prediction) => {
          const [x, y, boxWidth, boxHeight] = prediction.bbox;
          const centerX = x + boxWidth * 0.5;
          const centerY = y + boxHeight * 0.5;

          return {
            label: prediction.class,
            score: prediction.score,
            bbox: {
              x,
              y,
              width: boxWidth,
              height: boxHeight
            },
            normalizedBBox: {
              x: x / width,
              y: y / height,
              width: boxWidth / width,
              height: boxHeight / height
            },
            center: {
              x: centerX,
              y: centerY
            },
            normalizedCenter: {
              x: centerX / width,
              y: centerY / height
            }
          };
        });

      this.onDetections(detections);
    } catch (error) {
      console.error('Object detection failed:', error);
      this.onStatus({ phase: 'error', message: 'Detection failed during inference.' });
    } finally {
      this.isInferenceRunning = false;
    }
  };
}
