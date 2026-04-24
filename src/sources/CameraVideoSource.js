/**
 * Front/back camera video source via getUserMedia.
 *
 * Conforms to the informal VideoSource contract used by CameraInputLayer:
 *   - async initialize(): HTMLVideoElement
 *   - getVideoElement(): HTMLVideoElement
 *   - getDimensions(): { width, height }
 *   - shouldMirrorByDefault: boolean
 *   - dispose(): void
 *
 * Future implementations (RTMPVideoSource, WebRTCVideoSource, FileVideoSource)
 * only need to expose the same shape; CameraInputLayer / Experience never touch
 * the underlying transport details.
 */
export class CameraVideoSource {
  constructor({ facingMode = 'user', width = 1280, height = 720 } = {}) {
    this.facingMode = facingMode;
    this.preferredWidth = width;
    this.preferredHeight = height;

    this.stream = null;
    this.isReady = false;

    this.videoElement = document.createElement('video');
    this.videoElement.autoplay = true;
    this.videoElement.muted = true;
    this.videoElement.playsInline = true;
    this.videoElement.setAttribute('playsinline', '');
  }

  /** Front camera should be displayed mirrored (selfie-style). */
  get shouldMirrorByDefault() {
    return this.facingMode === 'user';
  }

  async initialize() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('getUserMedia is not supported in this browser.');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: this.facingMode,
        width: { ideal: this.preferredWidth },
        height: { ideal: this.preferredHeight }
      }
    });

    this.videoElement.srcObject = this.stream;
    await this.videoElement.play();
    this.isReady = true;
    return this.videoElement;
  }

  getVideoElement() {
    return this.videoElement;
  }

  getDimensions() {
    return {
      width: this.videoElement.videoWidth || this.preferredWidth,
      height: this.videoElement.videoHeight || this.preferredHeight
    };
  }

  dispose() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    this.videoElement.srcObject = null;
    this.isReady = false;
  }
}
