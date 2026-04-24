const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Minimal diagnostic overlay that draws every detection bbox as a thin dashed
 * rectangle. Hidden by default (the product only wants the contour glow for
 * the focused object); press `D` to toggle on for ML debugging.
 *
 * Mirror-aware so the boxes line up with what the user sees on screen, not
 * with the raw (un-flipped) video element.
 */
export class DetectionOverlay {
  constructor({ visible = false } = {}) {
    this.root = document.createElement('div');
    this.root.className = 'attrax-detection-overlay';

    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.classList.add('attrax-detection-overlay-svg');
    this.svg.setAttribute(
      'viewBox',
      `0 0 ${window.innerWidth} ${window.innerHeight}`
    );
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.root.appendChild(this.svg);

    document.body.appendChild(this.root);

    this.mirror = false;
    this.visible = visible;
    this.detections = [];
    this.focusedDetection = null;

    if (!visible) this.root.style.display = 'none';

    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);
  }

  setMirror(mirror) {
    if (this.mirror === mirror) return;
    this.mirror = mirror;
    this.render();
  }

  setVisible(visible) {
    this.visible = visible;
    this.root.style.display = visible ? '' : 'none';
  }

  toggle() {
    this.setVisible(!this.visible);
    return this.visible;
  }

  setDetections(detections, focusedDetection) {
    this.detections = detections || [];
    this.focusedDetection = focusedDetection || null;
    if (this.visible) this.render();
  }

  handleResize() {
    this.svg.setAttribute(
      'viewBox',
      `0 0 ${window.innerWidth} ${window.innerHeight}`
    );
    if (this.visible) this.render();
  }

  isFocused(detection) {
    if (!this.focusedDetection) return false;
    if (detection === this.focusedDetection) return true;
    if (detection.label !== this.focusedDetection.label) return false;
    const fc = this.focusedDetection.normalizedCenter;
    const dc = detection.normalizedCenter;
    return Math.abs(dc.x - fc.x) < 0.005 && Math.abs(dc.y - fc.y) < 0.005;
  }

  render() {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    if (!this.visible) return;

    const W = window.innerWidth;
    const H = window.innerHeight;

    for (const det of this.detections) {
      const bbox = det.normalizedBBox;
      const x = (this.mirror ? 1 - bbox.x - bbox.width : bbox.x) * W;
      const y = bbox.y * H;
      const w = Math.max(1, bbox.width * W);
      const h = Math.max(1, bbox.height * H);
      const focused = this.isFocused(det);

      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(w));
      rect.setAttribute('height', String(h));
      rect.setAttribute('rx', '6');
      rect.setAttribute(
        'class',
        focused ? 'attrax-bbox attrax-bbox-focused' : 'attrax-bbox'
      );
      this.svg.appendChild(rect);

      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', String(x + 6));
      text.setAttribute('y', String(Math.max(14, y - 5)));
      text.setAttribute(
        'class',
        focused
          ? 'attrax-bbox-label attrax-bbox-label-focused'
          : 'attrax-bbox-label'
      );
      const score = (det.score * 100).toFixed(0);
      const labelZh = det.labelZh || det.label;
      text.textContent =
        labelZh === det.label
          ? `${labelZh}  ${score}%`
          : `${labelZh} · ${det.label}  ${score}%`;
      this.svg.appendChild(text);
    }
  }

  dispose() {
    window.removeEventListener('resize', this.handleResize);
    this.root.remove();
  }
}
