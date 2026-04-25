import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { inferPlaybackKind, PLAYBACK_KIND, rtmpToHlsCandidates } from '../utils/streamPlayback.js';

function waitPlay(video) {
  return new Promise((resolve, reject) => {
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = (err) => {
      cleanup();
      if (err) {
        reject(err);
        return;
      }
      const mediaErr = video.error;
      if (mediaErr) {
        reject(new Error(`Video error code=${mediaErr.code}`));
        return;
      }
      reject(new Error('Video playback failed to start.'));
    };
    const cleanup = () => {
      video.removeEventListener('playing', done);
      video.removeEventListener('loadeddata', done);
      video.removeEventListener('error', fail);
    };
    if (video.readyState >= 2 && !video.paused) {
      resolve();
      return;
    }
    video.addEventListener('playing', done, { once: true });
    video.addEventListener('loadeddata', done, { once: true });
    video.addEventListener('error', () => fail(), { once: true });
    video.play().catch((e) => {
      const msg = e?.message ? String(e.message) : String(e);
      fail(new Error(`video.play() rejected: ${msg}`));
    });
  });
}

/**
 * URL-based stream or progressive file. Supports HLS (hls.js / Safari native),
 * HTTP-FLV (mpegts.js), direct http(s) progressive video, and RTMP URL
 * heuristics (tries common derived HLS URLs — browsers cannot play RTMP).
 *
 * Same informal contract as CameraVideoSource.
 */
export class StreamUrlVideoSource {
  /**
   * @param {{ url: string, mode?: 'auto' | 'hls' | 'flv' | 'native' }} options
   */
  constructor({ url, mode = 'auto' }) {
    this.url = String(url || '').trim();
    this.mode = mode;
    this.hls = null;
    this.mpegPlayer = null;
    this.isReady = false;

    this.videoElement = document.createElement('video');
    this.videoElement.autoplay = true;
    this.videoElement.muted = true;
    this.videoElement.playsInline = true;
    this.videoElement.setAttribute('playsinline', '');
    if (this.url.startsWith('http://') || this.url.startsWith('https://')) {
      this.videoElement.crossOrigin = 'anonymous';
    }
  }

  get shouldMirrorByDefault() {
    return false;
  }

  _teardownPlayers() {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.mpegPlayer) {
      try {
        this.mpegPlayer.pause();
        this.mpegPlayer.unload();
        this.mpegPlayer.detachMediaElement();
        this.mpegPlayer.destroy();
      } catch (e) {
        console.warn('mpegts teardown', e);
      }
      this.mpegPlayer = null;
    }
    this.videoElement.removeAttribute('src');
    this.videoElement.srcObject = null;
    this.videoElement.load();
  }

  async _playHls(url) {
    this._teardownPlayers();
    this.videoElement.crossOrigin = 'anonymous';

    if (this.videoElement.canPlayType('application/vnd.apple.mpegurl')) {
      this.videoElement.src = url;
      await waitPlay(this.videoElement);
      return;
    }

    if (!Hls.isSupported()) {
      throw new Error('HLS is not supported in this browser.');
    }

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true
    });
    this.hls = hls;

    await new Promise((resolve, reject) => {
      const onErr = (_, data) => {
        if (data.fatal) {
          hls.off(Hls.Events.ERROR, onErr);
          reject(new Error(data.type || 'HLS fatal error'));
        }
      };
      hls.on(Hls.Events.ERROR, onErr);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        hls.off(Hls.Events.ERROR, onErr);
        resolve();
      });
      hls.loadSource(url);
      hls.attachMedia(this.videoElement);
    });

    await waitPlay(this.videoElement);
  }

  async _playFlv(url) {
    this._teardownPlayers();
    this.videoElement.crossOrigin = 'anonymous';

    const features = mpegts.getFeatureList?.() || {};
    if (!mpegts.isSupported() || !features.mseLivePlayback) {
      throw new Error('HTTP-FLV / MSE live playback is not supported in this browser.');
    }

    const player = mpegts.createPlayer(
      {
        type: 'flv',
        isLive: true,
        cors: true,
        url
      },
      {
        enableWorker: true,
        lazyLoad: false
      }
    );
    this.mpegPlayer = player;
    player.attachMediaElement(this.videoElement);
    player.load();
    await player.play().catch(() => {});
    await waitPlay(this.videoElement);
  }

  async _playNative(url) {
    this._teardownPlayers();
    this.videoElement.crossOrigin = 'anonymous';
    this.videoElement.src = url;
    await waitPlay(this.videoElement);
  }

  async _playFromKind(kind, url) {
    if (kind === PLAYBACK_KIND.HLS) {
      await this._playHls(url);
      return;
    }
    if (kind === PLAYBACK_KIND.FLV) {
      await this._playFlv(url);
      return;
    }
    if (kind === PLAYBACK_KIND.NATIVE) {
      await this._playNative(url);
      return;
    }
    throw new Error(`Unsupported playback kind: ${kind}`);
  }

  async _tryAuto(url) {
    const inferred = inferPlaybackKind(url);
    if (inferred === PLAYBACK_KIND.RTMP) {
      const candidates = rtmpToHlsCandidates(url);
      let lastErr = new Error('No playable HLS URL derived from RTMP (浏览器不能直接播放 RTMP).');
      for (const candidate of candidates) {
        try {
          await this._playHls(candidate);
          this.url = candidate;
          return;
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr;
    }

    if (inferred === PLAYBACK_KIND.HLS) {
      await this._playHls(url);
      return;
    }
    if (inferred === PLAYBACK_KIND.FLV) {
      await this._playFlv(url);
      return;
    }

    try {
      await this._playNative(url);
      return;
    } catch (nativeErr) {
      try {
        await this._playHls(url);
        return;
      } catch {
        try {
          await this._playFlv(url);
          return;
        } catch {
          throw nativeErr;
        }
      }
    }
  }

  async initialize() {
    if (!this.url) {
      throw new Error('Stream URL is empty.');
    }

    this._teardownPlayers();

    const mode = this.mode === 'auto' ? 'auto' : this.mode;
    if (mode === 'hls') {
      await this._playHls(this.url);
    } else if (mode === 'flv') {
      await this._playFlv(this.url);
    } else if (mode === 'native') {
      await this._playNative(this.url);
    } else {
      await this._tryAuto(this.url);
    }

    this.isReady = true;
    return this.videoElement;
  }

  getVideoElement() {
    return this.videoElement;
  }

  getDimensions() {
    return {
      width: this.videoElement.videoWidth || 1280,
      height: this.videoElement.videoHeight || 720
    };
  }

  dispose() {
    this._teardownPlayers();
    this.isReady = false;
  }
}
