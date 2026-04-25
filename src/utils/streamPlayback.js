/**
 * Browser-friendly playback kinds. Raw RTMP cannot be decoded in HTML5;
 * LAN servers usually expose HLS (.m3u8) or HTTP-FLV in parallel.
 */
export const PLAYBACK_KIND = {
  HLS: 'hls',
  FLV: 'flv',
  NATIVE: 'native',
  RTMP: 'rtmp'
};

/** Infer how a URL should be played when the user picks "auto". */
export function inferPlaybackKind(raw) {
  const url = String(raw || '').trim();
  if (!url) {
    return PLAYBACK_KIND.NATIVE;
  }
  const lower = url.toLowerCase();
  if (lower.startsWith('rtmp://') || lower.startsWith('rtmps://')) {
    return PLAYBACK_KIND.RTMP;
  }
  if (lower.includes('.m3u8')) {
    return PLAYBACK_KIND.HLS;
  }
  if (lower.endsWith('.flv') || lower.includes('.flv?')) {
    return PLAYBACK_KIND.FLV;
  }
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    return PLAYBACK_KIND.NATIVE;
  }
  return PLAYBACK_KIND.NATIVE;
}

/**
 * Build likely HTTP HLS URLs from an RTMP publish URL (nginx-rtmp / SRS style).
 * Example: rtmp://192.168.31.68/live/cam0 → several http://…/….m3u8 candidates.
 *
 * @param {string} rtmpUrl
 * @returns {string[]}
 */
export function rtmpToHlsCandidates(rtmpUrl) {
  const trimmed = String(rtmpUrl || '').trim();
  if (!trimmed) {
    return [];
  }

  let host = '';
  let pathname = '';

  try {
    const u = new URL(trimmed.replace(/^rtmps?:/i, 'http:'));
    host = u.hostname;
    pathname = u.pathname || '';
  } catch {
    return [];
  }

  const segments = pathname.split('/').filter(Boolean);
  const stream = segments.pop() || 'stream';
  const app = segments.pop() || 'live';
  const scheme = 'http';
  const base = `${scheme}://${host}`;
  const baseHls8088 = `${scheme}://${host}:8088`;

  const candidates = new Set();
  // User-provided LAN server commonly exposes HLS at :8088/live/index.m3u8
  // when the RTMP publish key is just /live (no stream name in path).
  if (app === 'live' && stream === 'live') {
    candidates.add(`${baseHls8088}/live/index.m3u8`);
  }

  // When stream name exists, still try both :8088 and default :80.
  candidates.add(`${baseHls8088}/${app}/${stream}.m3u8`);
  candidates.add(`${baseHls8088}/live/${stream}.m3u8`);
  candidates.add(`${baseHls8088}/hls/${stream}.m3u8`);
  candidates.add(`${baseHls8088}/${stream}.m3u8`);

  candidates.add(`${base}/${app}/${stream}.m3u8`);
  candidates.add(`${base}/hls/${stream}.m3u8`);
  candidates.add(`${base}/live/${stream}.m3u8`);
  candidates.add(`${base}/${stream}.m3u8`);
  if (app && stream) {
    candidates.add(`${base}/rtc/v1/play/?app=${encodeURIComponent(app)}&stream=${encodeURIComponent(stream)}`);
  }
  return [...candidates];
}
