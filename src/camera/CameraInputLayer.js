import {
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  VideoTexture
} from 'three';

/**
 * Renders a VideoSource as a fullscreen plane in front of the given parent
 * (typically the camera). Supports horizontal mirroring without flipping the
 * underlying video element, so detection / segmentation models still receive
 * the original (un-mirrored) frame.
 *
 * Anything you want rendered "on top of the video in image-space" should be
 * added as a child of `surface` (or `frameGroup`) so it inherits the same
 * mirror transform automatically.
 */
export class CameraInputLayer {
  constructor(parent, videoSource, {
    mirror = false,
    distance = 4.6,
    fillOverscan = 1
  } = {}) {
    this.parent = parent;
    this.videoSource = videoSource;
    this.mirror = mirror;
    this.distance = distance;
    this.fillOverscan = fillOverscan;

    this.videoTexture = null;
    this.isReady = false;

    this.root = new Group();
    this.root.name = 'camera-input-layer';

    this.frameGroup = new Group();
    this.frameGroup.name = 'camera-frame';
    this.frameGroup.scale.x = mirror ? -1 : 1;
    this.root.add(this.frameGroup);

    this.surface = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ color: '#020810' })
    );
    this.surface.position.set(0, 0, -this.distance);
    this.frameGroup.add(this.surface);

    this.parent.add(this.root);
  }

  async initialize() {
    try {
      await this.videoSource.initialize();

      this.videoTexture = new VideoTexture(this.videoSource.getVideoElement());
      this.videoTexture.colorSpace = SRGBColorSpace;
      this.videoTexture.minFilter = LinearFilter;
      this.videoTexture.magFilter = LinearFilter;
      this.videoTexture.generateMipmaps = false;

      this.surface.material.map = this.videoTexture;
      this.surface.material.color.set('#ffffff');
      this.surface.material.needsUpdate = true;

      this.isReady = true;
      return true;
    } catch (error) {
      console.error('Camera input layer initialization failed:', error);
      this.isReady = false;
      return false;
    }
  }

  /**
   * Hot-swap the backing video source (same contract as initialize()).
   *
   * @param {*} newSource
   * @param {{ mirror?: boolean }} [options]
   */
  async replaceVideoSource(newSource, { mirror } = {}) {
    if (mirror != null) {
      this.setMirror(mirror);
    }

    try {
      await newSource.initialize();
    } catch (error) {
      console.error('replaceVideoSource: new source failed', error);
      newSource.dispose();
      throw error;
    }

    if (this.videoTexture) {
      this.videoTexture.dispose();
      this.videoTexture = null;
    }
    this.videoSource?.dispose();
    this.videoSource = newSource;

    this.videoTexture = new VideoTexture(this.videoSource.getVideoElement());
    this.videoTexture.colorSpace = SRGBColorSpace;
    this.videoTexture.minFilter = LinearFilter;
    this.videoTexture.magFilter = LinearFilter;
    this.videoTexture.generateMipmaps = false;

    this.surface.material.map = this.videoTexture;
    this.surface.material.color.set('#ffffff');
    this.surface.material.needsUpdate = true;

    this.isReady = true;
    return true;
  }

  setMirror(value) {
    this.mirror = Boolean(value);
    this.frameGroup.scale.x = this.mirror ? -1 : 1;
  }

  fitToCamera(camera) {
    const distance = Math.abs(this.surface.position.z - camera.position.z);
    const frustumHeight = 2 * Math.tan((camera.fov * Math.PI) / 360) * distance;
    const frustumWidth = frustumHeight * camera.aspect;

    this.surface.scale.set(
      frustumWidth * this.fillOverscan,
      frustumHeight * this.fillOverscan,
      1
    );
  }

  /** The mesh whose XY span equals the rendered video; attach overlays here. */
  getSurface() {
    return this.surface;
  }

  getVideoElement() {
    return this.videoSource.getVideoElement();
  }

  getDimensions() {
    return this.videoSource.getDimensions();
  }

  dispose() {
    if (this.videoTexture) {
      this.videoTexture.dispose();
      this.videoTexture = null;
    }
    this.videoSource?.dispose();
    this.isReady = false;
  }
}
