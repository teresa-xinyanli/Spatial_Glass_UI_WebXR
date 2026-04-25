import { inferPlaybackKind, PLAYBACK_KIND } from '../utils/streamPlayback.js';

const STORAGE_ORIGIN = 'attrax-live-origin';

/** Default LAN server base (no trailing slash). */
export const DEFAULT_LIVE_ORIGIN = 'http://192.168.31.68';

const DEFAULT_RTMP_URL = 'rtmp://192.168.31.68:1935/live';
const DEFAULT_HLS_URL = 'http://192.168.31.68:8088/live/index.m3u8';
const DEFAULT_WEBRTC_URL = 'http://192.168.31.68:8889/live/';

function normalizeOrigin(raw) {
  const s = String(raw || '').trim() || DEFAULT_LIVE_ORIGIN;
  try {
    const u = new URL(s.includes('://') ? s : `http://${s}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return DEFAULT_LIVE_ORIGIN;
  }
}

function kindLabel(kind) {
  if (kind === PLAYBACK_KIND.HLS) return 'HLS';
  if (kind === PLAYBACK_KIND.FLV) return 'HTTP-FLV';
  if (kind === PLAYBACK_KIND.RTMP) return 'RTMP→HLS 候选';
  return '原生 / 自动';
}

/**
 * Top-left HUD: live server base URL, preset stream picks, custom URL + connect.
 * Invokes `onApply(spec)` where spec is `{ type:'camera', facingMode }` or
 * `{ type:'stream', url, mode }`.
 */
export class VideoSourcePanel {
  constructor({ onApply, storageKey = STORAGE_ORIGIN } = {}) {
    this.onApply = onApply;
    this.storageKey = storageKey;
    this.specByValue = new Map();

    this.root = document.createElement('div');
    this.root.className = 'attrax-video-source-panel';

    const title = document.createElement('div');
    title.className = 'attrax-video-source-title';
    title.textContent = '视频输入';

    const pushTitle = document.createElement('div');
    pushTitle.className = 'attrax-video-source-subtitle';
    pushTitle.textContent = '推流配置（OBS）';

    const pushGrid = document.createElement('div');
    pushGrid.className = 'attrax-video-source-grid';

    pushGrid.append(
      this.makeCopyRow('OBS 服务器', 'rtmp://192.168.31.68:1935/'),
      this.makeCopyRow('OBS 串流密钥', 'live'),
      this.makeCopyRow('完整 RTMP', DEFAULT_RTMP_URL),
      this.makeCopyRow('HLS 播放', DEFAULT_HLS_URL),
      this.makeCopyRow('WebRTC 播放页', DEFAULT_WEBRTC_URL, { open: true })
    );

    this.hintEl = document.createElement('div');
    this.hintEl.className = 'attrax-video-source-hint';

    const originRow = document.createElement('div');
    originRow.className = 'attrax-video-source-row';
    const originLabel = document.createElement('label');
    originLabel.className = 'attrax-video-source-label';
    originLabel.textContent = '直播服务器';
    originLabel.setAttribute('for', 'attrax-live-origin');
    this.originInput = document.createElement('input');
    this.originInput.id = 'attrax-live-origin';
    this.originInput.type = 'text';
    this.originInput.className = 'attrax-video-source-input';
    this.originInput.value =
      typeof localStorage !== 'undefined' && localStorage.getItem(this.storageKey)
        ? localStorage.getItem(this.storageKey)
        : DEFAULT_LIVE_ORIGIN;
    this.originInput.autocomplete = 'off';
    this.originInput.spellcheck = false;
    originRow.append(originLabel, this.originInput);

    const selectRow = document.createElement('div');
    selectRow.className = 'attrax-video-source-row';
    const selLabel = document.createElement('label');
    selLabel.className = 'attrax-video-source-label';
    selLabel.textContent = '信号源';
    selLabel.setAttribute('for', 'attrax-video-select');
    this.select = document.createElement('select');
    this.select.id = 'attrax-video-select';
    this.select.className = 'attrax-video-source-select';
    selectRow.append(selLabel, this.select);

    this.customRow = document.createElement('div');
    this.customRow.className = 'attrax-video-source-row attrax-video-source-custom';
    this.customRow.hidden = true;
    this.urlInput = document.createElement('input');
    this.urlInput.type = 'text';
    this.urlInput.className = 'attrax-video-source-input';
    this.urlInput.placeholder = 'https://… 或 rtmp://…（自动尝试 HLS）';
    this.urlInput.autocomplete = 'off';
    this.urlInput.spellcheck = false;
    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'attrax-video-source-btn';
    applyBtn.textContent = '连接';
    this.customRow.append(this.urlInput, applyBtn);

    this.root.append(title, pushTitle, pushGrid, this.hintEl, originRow, selectRow, this.customRow);
    document.body.appendChild(this.root);

    this.rebuildSelectOptions();
    this.setHint('');

    this.originInput.addEventListener('change', () => {
      try {
        localStorage.setItem(this.storageKey, this.originInput.value.trim());
      } catch {
        /* ignore */
      }
      this.rebuildSelectOptions();
    });

    this.select.addEventListener('change', () => {
      this.onSelectChange();
    });

    applyBtn.addEventListener('click', () => {
      this.applyCustom();
    });

    this.urlInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        this.applyCustom();
      }
    });
  }

  rebuildSelectOptions() {
    const origin = normalizeOrigin(this.originInput.value);
    this.originInput.value = origin;

    this.specByValue.clear();
    this.select.replaceChildren();

    const addOption = (value, label, spec) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      this.select.appendChild(opt);
      this.specByValue.set(value, spec);
    };

    addOption('cam-front', '本机 · 前置摄像头', { type: 'camera', facingMode: 'user' });
    addOption('cam-back', '本机 · 后置摄像头', { type: 'camera', facingMode: 'environment' });
    addOption(
      'lan-hls-index',
      `192.168.31.68 · HLS（:8088/live/index.m3u8）`,
      { type: 'stream', url: DEFAULT_HLS_URL, mode: 'hls' }
    );
    addOption('custom', '自定义地址（自动检测）', null);

    this.select.value = 'cam-front';
    this.customRow.hidden = true;
  }

  onSelectChange() {
    const v = this.select.value;
    if (v === 'custom') {
      this.customRow.hidden = false;
      const u = this.urlInput.value.trim();
      this.setHint(u ? `将按「${kindLabel(inferPlaybackKind(u))}」尝试` : '输入 URL 后点「连接」');
      return;
    }
    this.customRow.hidden = true;
    const spec = this.specByValue.get(v);
    if (spec && this.onApply) {
      if (spec.type === 'stream') {
        this.setHint(`${kindLabel(spec.mode === 'auto' ? inferPlaybackKind(spec.url) : spec.mode)} · ${spec.url}`);
      } else {
        this.setHint('本机摄像头');
      }
      this.onApply(spec);
    }
  }

  applyCustom() {
    const url = this.urlInput.value.trim();
    if (!url) {
      this.setHint('请输入地址');
      return;
    }
    const inferred = inferPlaybackKind(url);
    this.setHint(`自动：${kindLabel(inferred)}`);
    if (this.onApply) {
      this.onApply({ type: 'stream', url, mode: 'auto' });
    }
  }

  setHint(text) {
    this.hintEl.textContent = text || '';
    this.hintEl.hidden = !text;
  }

  makeCopyRow(label, value, { open = false } = {}) {
    const row = document.createElement('div');
    row.className = 'attrax-video-source-grid-row';

    const l = document.createElement('div');
    l.className = 'k';
    l.textContent = label;

    const v = document.createElement('div');
    v.className = 'v';
    v.textContent = value;
    v.title = value;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'attrax-video-source-mini-btn';
    btn.textContent = open ? '打开' : '复制';
    btn.addEventListener('click', async () => {
      if (open) {
        window.open(value, '_blank', 'noopener,noreferrer');
        return;
      }
      try {
        await navigator.clipboard.writeText(value);
        this.setHint(`已复制：${label}`);
      } catch {
        this.setHint('复制失败（浏览器权限限制）');
      }
    });

    row.append(l, v, btn);
    return row;
  }

  dispose() {
    this.root.remove();
  }
}
