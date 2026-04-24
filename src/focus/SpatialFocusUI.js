const STYLE_ID = 'attrax-spatial-focus-ui-style';

const POPUP_OPTIONS = [
  { action: 'inspect', label: 'Inspect' },
  { action: 'pin', label: 'Pin' },
  { action: 'track', label: 'Track' }
];

const POPUP_WIDTH = 228;
const POPUP_HEIGHT_ESTIMATE = 172;
const POPUP_MARGIN = 18;
const POPUP_OFFSET = 14; // distance from the object's bbox to the popup edge

// Budgets reserved inside the clamp so that render-time effects can't push
// the visible card past the viewport edge. Values are in CSS pixels:
//   - HOVER_SCALE already expands the card by up to 8% each side
//   - the 3D rotateX/Y perspective shears corners by a few extra pixels
//   - camera-rotation parallax (4% of the shorter viewport edge, see
//     Experience.computePopupParallaxOffset) is added AFTER the anchor damp
//     so we have to pre-reserve its full magnitude here or the popup would
//     occasionally leak off screen at extreme camera angles.
const POPUP_TILT_SAFETY_PX = 10;
const POPUP_PARALLAX_BUDGET_FRACTION = 0.04;

// Anchor deadzone: kept intentionally tiny. A larger threshold creates
// "stop motion" -- slow drift below the threshold is swallowed until it
// suddenly crosses the edge and the popup teleports a frame, giving the
// UX a "locked in place then rubber-banding" feel. The upstream EMA and
// the popupX/Y damp below already absorb all meaningful detector noise,
// so we only reject sub-pixel churn here.
const POPUP_ANCHOR_DEADZONE_PX = 2;

// TiltedCard (React Bits) defaults, ported to vanilla. The component tilts
// the card proportional to the cursor's offset from the card center, clamped
// by this angle, and scales it up while hovered. We use a spring-like damp
// (lambda picked to approximate their stiffness=100, damping=30, mass=2
// critically-damped feel) on the three current values.
const HOVER_ROTATE_AMPLITUDE_DEG = 14;
const HOVER_SCALE = 1.08;

function damp(current, target, lambda, deltaTime) {
  return current + (target - current) * (1 - Math.exp(-lambda * deltaTime));
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .attrax-focus-root {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 12;
      overflow: hidden;
      perspective: 1400px;
    }

    .attrax-ping-svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }

    .attrax-ping-dot {
      fill: none;
      stroke: var(--attrax-accent, rgba(190, 230, 255, 0.92));
      stroke-width: 1.2;
      filter: drop-shadow(0 0 6px rgba(150, 214, 255, 0.6));
    }

    .attrax-ping-ring {
      fill: none;
      stroke: var(--attrax-accent, rgba(190, 230, 255, 0.92));
      stroke-width: 1.2;
      opacity: 0.7;
      transform-origin: center;
      animation: attrax-ping 2.1s ease-out infinite;
    }

    .attrax-ping-ring.delayed { animation-delay: 0.7s; }

    @keyframes attrax-ping {
      0%   { r: 6;  opacity: 0.7; }
      100% { r: 26; opacity: 0;   }
    }

    .attrax-popup-connector {
      fill: none;
      stroke: var(--attrax-accent, rgba(190, 230, 255, 0.92));
      stroke-width: 1;
      stroke-dasharray: 2 4;
      opacity: 0.38;
      filter: drop-shadow(0 0 3px rgba(150, 214, 255, 0.45));
    }

    /*
     * The popup card is a transparent wrapper. The glass pane itself is
     * rendered in 3D by FluidGlassPanel, which refracts the camera feed
     * behind it. Everything below only provides layout + typography so the
     * text reads on top of that refraction.
     */
    /*
     * The popup card is a transparent wrapper. The glass pane itself is
     * rendered in 3D by FluidGlassPanel (Apple Liquid Glass style -- neutral,
     * bright, with a bright geometric edge). Everything below only provides
     * layout + typography that reads cleanly on top of that refraction.
     */
    .attrax-spatial-popup {
      position: fixed;
      left: 0;
      top: 0;
      width: ${POPUP_WIDTH}px;
      border-radius: 22px;
      padding: 14px 0 6px;
      background: transparent;
      border: none;
      box-shadow: none;
      overflow: hidden;
      transform: translate3d(-9999px, -9999px, 0) scale(0.92);
      opacity: 0;
      /* Rotate around the card's center so the TiltedCard tilt pivots the
         way React Bits does (pulling the nearest corner toward the cursor),
         instead of the old bottom-left entrance-animation pivot. */
      transform-origin: 50% 50%;
      pointer-events: none;
      will-change: transform, opacity;
      transform-style: preserve-3d;
      color: rgba(255, 255, 255, 0.94);
    }

    .attrax-spatial-popup-title {
      margin: 0 16px 6px;
      font-size: 10px;
      color: rgba(255, 255, 255, 0.55);
      letter-spacing: 0.16em;
      text-transform: uppercase;
      display: flex;
      align-items: center;
      gap: 7px;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
    }

    .attrax-spatial-popup-title::before {
      content: '';
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.9);
      box-shadow: 0 0 6px rgba(255, 255, 255, 0.55);
      flex-shrink: 0;
    }

    .attrax-spatial-popup-label {
      margin: 0 16px 10px;
      padding: 0 0 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.14);
      font-size: 15px;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.98);
      display: flex;
      align-items: baseline;
      gap: 8px;
      text-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
    }

    .attrax-spatial-popup-label .zh {
      letter-spacing: 0.02em;
    }

    .attrax-spatial-popup-label .en {
      font-size: 11px;
      font-weight: 400;
      color: rgba(255, 255, 255, 0.55);
      letter-spacing: 0.04em;
    }

    .attrax-spatial-popup-label .score {
      margin-left: auto;
      font-size: 11px;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.78);
      font-variant-numeric: tabular-nums;
    }

    /* Apple-style menu items: full-width rows, no per-button card, just a
       subtle hairline between rows. The 3D glass panel behind does all the
       visual heavy lifting. */
    .attrax-spatial-popup-options {
      display: flex;
      flex-direction: column;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .attrax-spatial-popup-options li:not(:last-child) .attrax-spatial-popup-option {
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .attrax-spatial-popup-option {
      width: 100%;
      border: none;
      border-radius: 0;
      background: transparent;
      color: rgba(255, 255, 255, 0.94);
      font: inherit;
      font-size: 14px;
      padding: 10px 16px;
      text-align: left;
      cursor: pointer;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
      transition:
        background-color 180ms ease,
        color 180ms ease;
    }

    .attrax-spatial-popup-option:hover,
    .attrax-spatial-popup-option:focus-visible,
    .attrax-spatial-popup-option.is-selected {
      outline: none;
      background: rgba(255, 255, 255, 0.1);
      color: rgba(255, 255, 255, 1);
    }

    .attrax-spatial-popup-option:active {
      background: rgba(255, 255, 255, 0.16);
    }
  `;

  document.head.appendChild(style);
}

/**
 * Glass popup + ping dot + connector line shown next to the focused object.
 * The actual silhouette glow is rendered in WebGL by FocusHighlightLayer;
 * everything in this file is screen-space DOM/SVG.
 *
 * Responsibilities:
 *   - Position the popup next to the object's bbox with edge avoidance so
 *     it never gets clipped by the viewport.
 *   - Tilt the popup slightly based on pointer position (Vision Pro style
 *     card parallax).
 *   - Draw a ping dot at the object's center + a dashed connector line
 *     from the popup's anchor edge to the ping dot.
 *   - Apply class palette color to all the above via CSS custom properties.
 */
export class SpatialFocusUI {
  constructor({ onAction = () => {} } = {}) {
    ensureStyles();

    this.onAction = onAction;
    this.selectedAction = null;
    this.focusedObject = null;

    this.viewport = {
      width: window.innerWidth,
      height: window.innerHeight
    };

    this.pointerClient = {
      x: this.viewport.width * 0.5,
      y: this.viewport.height * 0.5
    };

    // current / target are for the popup card center and visual state.
    this.current = {
      popupX: this.viewport.width * 0.5,
      popupY: this.viewport.height * 0.5,
      opacity: 0,
      scale: 0.92,
      tiltX: 0,
      tiltY: 0
    };

    this.target = {
      popupX: this.current.popupX,
      popupY: this.current.popupY,
      opacity: 0,
      scale: 0.92,
      tiltX: 0,
      tiltY: 0
    };

    // The entrance spring: when visibility flips on, bump scale briefly.
    this._wasVisible = false;
    this._entranceTimer = 0;

    // World-anchor parallax: a small 2D offset pushed in from Experience
    // every frame (driven by camera.rotation). Applied at render time only,
    // so the damp + deadzone + ping origin all stay wired to the pure
    // detection-driven anchor.
    this.currentParallax = { x: 0, y: 0 };

    this.root = document.createElement('div');
    this.root.className = 'attrax-focus-root';

    this.pingSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.pingSvg.classList.add('attrax-ping-svg');
    this.pingSvg.setAttribute(
      'viewBox',
      `0 0 ${this.viewport.width} ${this.viewport.height}`
    );
    this.pingSvg.setAttribute('preserveAspectRatio', 'none');

    this.pingGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.pingSvg.appendChild(this.pingGroup);
    this.root.appendChild(this.pingSvg);

    this.popup = document.createElement('div');
    this.popup.className = 'attrax-spatial-popup';

    this.popupTitle = document.createElement('p');
    this.popupTitle.className = 'attrax-spatial-popup-title';
    this.popupTitle.textContent = 'Focused Object';

    this.popupLabel = document.createElement('p');
    this.popupLabel.className = 'attrax-spatial-popup-label';

    this.labelZh = document.createElement('span');
    this.labelZh.className = 'zh';
    this.labelZh.textContent = '--';

    this.labelEn = document.createElement('span');
    this.labelEn.className = 'en';

    this.labelScore = document.createElement('span');
    this.labelScore.className = 'score';

    this.popupLabel.append(this.labelZh, this.labelEn, this.labelScore);

    this.popupOptions = document.createElement('ul');
    this.popupOptions.className = 'attrax-spatial-popup-options';

    for (const option of POPUP_OPTIONS) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'attrax-spatial-popup-option';
      button.dataset.action = option.action;
      button.textContent = option.label;
      item.appendChild(button);
      this.popupOptions.appendChild(item);
    }

    this.popup.append(this.popupTitle, this.popupLabel, this.popupOptions);
    this.root.appendChild(this.popup);

    this.popupClickHandler = (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button || this.current.opacity < 0.6 || !this.focusedObject) {
        return;
      }

      this.selectedAction = button.dataset.action;
      this.updateSelectedActionStyles();

      this.onAction({
        action: this.selectedAction,
        label: button.textContent,
        focusLabel: this.focusedObject.label,
        focusLabelZh: this.focusedObject.labelZh,
        focusScore: this.focusedObject.score,
        source: this.focusedObject.source
      });
    };

    this.popup.addEventListener('click', this.popupClickHandler);

    // TiltedCard hover state. Driven from per-frame pointer sampling inside
    // update() rather than from DOM mouseenter/leave, because those can be
    // skipped (a) while pointer-events are toggling between none/auto as
    // the popup fades in and (b) when the popup appears under a stationary
    // cursor (no crossing == no mouseenter fires). Sampling the already-
    // tracked window pointer every frame sidesteps both problems and keeps
    // the DOM tilt, the scale-on-hover, and the 3D glass's setRotation all
    // reading from the same source of truth.
    this.isHovering = false;

    this.handleResize = this.handleResize.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('pointermove', this.handlePointerMove, { passive: true });

    document.body.appendChild(this.root);
  }

  handleResize() {
    this.viewport.width = window.innerWidth;
    this.viewport.height = window.innerHeight;
    this.pingSvg.setAttribute(
      'viewBox',
      `0 0 ${this.viewport.width} ${this.viewport.height}`
    );
  }

  handlePointerMove(event) {
    this.pointerClient.x = event.clientX;
    this.pointerClient.y = event.clientY;
  }

  updateSelectedActionStyles() {
    const buttons = this.popup.querySelectorAll('button[data-action]');
    for (const button of buttons) {
      button.classList.toggle(
        'is-selected',
        button.dataset.action === this.selectedAction
      );
    }
  }

  /**
   * Safe inset that the popup center must stay within so that the fully-
   * rendered card (at max hover scale, including CSS tilt shear and the
   * world-anchor parallax offset applied post-damp in update()) is
   * guaranteed to lie inside the viewport with POPUP_MARGIN breathing room.
   *
   * Using the live measured offsetHeight instead of POPUP_HEIGHT_ESTIMATE
   * keeps this correct when the label wraps, fonts change metrics on load,
   * or future localisation changes the row count.
   */
  getPopupSafeBounds() {
    const W = this.viewport.width;
    const H = this.viewport.height;

    // Reserve the maximum possible scale (HOVER_SCALE) even when the card
    // is at rest, so that a hover-in doesn't pop the card out of the safe
    // zone and momentarily clip.
    const maxScale = HOVER_SCALE;
    const halfW = POPUP_WIDTH * maxScale * 0.5;
    const baseHeight = this.popup.offsetHeight || POPUP_HEIGHT_ESTIMATE;
    const halfH = baseHeight * maxScale * 0.5;

    const parallaxPad = Math.min(W, H) * POPUP_PARALLAX_BUDGET_FRACTION;
    const pad = POPUP_MARGIN + POPUP_TILT_SAFETY_PX + parallaxPad;

    return {
      minX: halfW + pad,
      maxX: W - halfW - pad,
      minY: halfH + pad,
      maxY: H - halfH - pad
    };
  }

  /**
   * Bounds used by the final render-time clamp. Unlike getPopupSafeBounds
   * this one reserves only the CURRENT scale plus the tilt perspective
   * budget -- no parallax budget, because parallax is already baked into
   * the position before clamping. Acts as a hard guarantee that the card
   * is inside the viewport (with margin) regardless of any upstream drift.
   */
  getPopupRenderBounds() {
    const W = this.viewport.width;
    const H = this.viewport.height;

    // Use live scale but never shrink the safe zone below a floor -- during
    // fade-out the card's scale falls to 0.92 and we still want the clamp
    // to assume something close to full size so a retargetting jump doesn't
    // briefly ride the edge before the opacity reaches the hide threshold.
    const activeScale = Math.max(this.current.scale, 1);
    const halfW = POPUP_WIDTH * activeScale * 0.5;
    const baseHeight = this.popup.offsetHeight || POPUP_HEIGHT_ESTIMATE;
    const halfH = baseHeight * activeScale * 0.5;

    const pad = POPUP_MARGIN + POPUP_TILT_SAFETY_PX;
    return {
      minX: halfW + pad,
      maxX: W - halfW - pad,
      minY: halfH + pad,
      maxY: H - halfH - pad
    };
  }

  /**
   * Given the focused object's bbox center (in screen pixels) + size, picks
   * a popup anchor point near the object but pushed away from viewport edges.
   *
   * Placement priority: TOP → RIGHT → BOTTOM → LEFT. We pick the first side
   * where the popup center lands fully inside the safe zone. If none fits
   * (tiny viewport, huge object), we fall back to the side that overflows
   * by the smallest margin so the clamp pushes the popup back in with the
   * least visual disruption.
   */
  computePopupPosition(objectCenter, bboxSize) {
    const bounds = this.getPopupSafeBounds();
    const popupH = this.popup.offsetHeight || POPUP_HEIGHT_ESTIMATE;
    const popupHalfW = POPUP_WIDTH * 0.5;
    const popupHalfH = popupH * 0.5;

    // Four candidate anchor centers, in priority order.
    const candidates = [
      {
        side: 'top',
        x: objectCenter.x,
        y: objectCenter.y - bboxSize.halfH - POPUP_OFFSET - popupHalfH
      },
      {
        side: 'right',
        x: objectCenter.x + bboxSize.halfW + POPUP_OFFSET + popupHalfW,
        y: objectCenter.y
      },
      {
        side: 'bottom',
        x: objectCenter.x,
        y: objectCenter.y + bboxSize.halfH + POPUP_OFFSET + popupHalfH
      },
      {
        side: 'left',
        x: objectCenter.x - bboxSize.halfW - POPUP_OFFSET - popupHalfW,
        y: objectCenter.y
      }
    ];

    const fits = (c) =>
      c.x >= bounds.minX
      && c.x <= bounds.maxX
      && c.y >= bounds.minY
      && c.y <= bounds.maxY;

    let chosen = candidates.find(fits);

    if (!chosen) {
      // Nothing fits: pick the candidate with the smallest combined axis
      // overflow, so the final clamp only has to shove it a tiny bit.
      let bestOverflow = Infinity;
      for (const c of candidates) {
        const ox = Math.max(0, bounds.minX - c.x, c.x - bounds.maxX);
        const oy = Math.max(0, bounds.minY - c.y, c.y - bounds.maxY);
        const overflow = ox + oy;
        if (overflow < bestOverflow) {
          bestOverflow = overflow;
          chosen = c;
        }
      }
    }

    let popupX = Math.min(Math.max(chosen.x, bounds.minX), bounds.maxX);
    let popupY = Math.min(Math.max(chosen.y, bounds.minY), bounds.maxY);

    // Degenerate case: viewport smaller than the popup + padding. Fall back
    // to dead-center so we never pass NaN / inverted bounds downstream.
    if (bounds.maxX < bounds.minX) popupX = this.viewport.width * 0.5;
    if (bounds.maxY < bounds.minY) popupY = this.viewport.height * 0.5;

    return { x: popupX, y: popupY, side: chosen.side };
  }

  renderPingAndConnector(objectCenter, popupCenter, popupSide) {
    while (this.pingGroup.firstChild) {
      this.pingGroup.removeChild(this.pingGroup.firstChild);
    }
    if (this.current.opacity < 0.12 || !objectCenter) return;

    const NS = 'http://www.w3.org/2000/svg';

    // Attach the connector to whichever popup edge faces the object. The
    // half-sizes use current.scale so the line lands on the *rendered*
    // card edge during hover-scale changes instead of a static size.
    const popupHalfW = POPUP_WIDTH * this.current.scale * 0.5;
    const baseHeight = this.popup.offsetHeight || POPUP_HEIGHT_ESTIMATE;
    const popupHalfH = baseHeight * this.current.scale * 0.5;

    let popupAnchorX = popupCenter.x;
    let popupAnchorY = popupCenter.y;
    if (popupSide === 'top') popupAnchorY = popupCenter.y + popupHalfH;
    else if (popupSide === 'bottom') popupAnchorY = popupCenter.y - popupHalfH;
    else if (popupSide === 'left') popupAnchorX = popupCenter.x + popupHalfW;
    else popupAnchorX = popupCenter.x - popupHalfW; // 'right'

    const connector = document.createElementNS(NS, 'path');
    const midX = (objectCenter.x + popupAnchorX) * 0.5;
    const midY = (objectCenter.y + popupAnchorY) * 0.5;
    connector.setAttribute(
      'd',
      `M ${objectCenter.x} ${objectCenter.y} `
        + `Q ${midX} ${midY} ${popupAnchorX} ${popupAnchorY}`
    );
    connector.setAttribute('class', 'attrax-popup-connector');
    connector.setAttribute('opacity', String(this.current.opacity * 0.65));
    this.pingGroup.appendChild(connector);

    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', String(objectCenter.x));
    dot.setAttribute('cy', String(objectCenter.y));
    dot.setAttribute('r', '3');
    dot.setAttribute('class', 'attrax-ping-dot');
    dot.setAttribute('opacity', String(this.current.opacity));
    this.pingGroup.appendChild(dot);

    // Two staggered rings expanding outward.
    for (let i = 0; i < 2; i++) {
      const ring = document.createElementNS(NS, 'circle');
      ring.setAttribute('cx', String(objectCenter.x));
      ring.setAttribute('cy', String(objectCenter.y));
      ring.setAttribute('r', '6');
      ring.setAttribute(
        'class',
        i === 0 ? 'attrax-ping-ring' : 'attrax-ping-ring delayed'
      );
      ring.setAttribute('opacity', String(this.current.opacity * 0.85));
      this.pingGroup.appendChild(ring);
    }
  }

  /**
   * @param {object} args
   * @param {object|null} args.focusedObject
   * @param {{x:number,y:number}|null} args.popupAnchor screen-pixel anchor
   *        (object center). Can be null when nothing is focused.
   * @param {{halfW:number, halfH:number}|null} args.bboxSize bbox half-size
   *        in screen pixels. Used for popup avoidance.
   * @param {{x:number,y:number}|null} [args.parallaxOffset] Small 2D offset
   *        applied ONLY to the popup's rendered position (not its target),
   *        so world-anchored parallax doesn't fight the anchor deadzone and
   *        the ping marker stays glued to the actual object. Caller is
   *        responsible for bounding the magnitude (spec: <5% of viewport).
   * @param {boolean} args.showPopup
   * @param {number} args.elapsedTime
   * @param {number} args.deltaTime
   */
  update({
    focusedObject,
    popupAnchor,
    bboxSize,
    parallaxOffset,
    showPopup,
    elapsedTime,
    deltaTime
  }) {
    // Store parallax for use by getPopupScreenRect / isPointInPopup, which
    // both need the VISUALLY rendered rect (post-parallax) to stay in sync
    // with what the user sees.
    this.currentParallax.x = parallaxOffset?.x ?? 0;
    this.currentParallax.y = parallaxOffset?.y ?? 0;
    this.focusedObject = focusedObject;
    const visible = Boolean(focusedObject && showPopup && popupAnchor);

    if (focusedObject) {
      this.labelZh.textContent = focusedObject.labelZh || focusedObject.label || '--';
      this.labelEn.textContent =
        focusedObject.labelZh && focusedObject.labelZh !== focusedObject.label
          ? focusedObject.label
          : '';
      this.labelScore.textContent = `${(focusedObject.score * 100).toFixed(0)}%`;
    } else {
      this.labelZh.textContent = '--';
      this.labelEn.textContent = '';
      this.labelScore.textContent = '';
      this.selectedAction = null;
      this.updateSelectedActionStyles();
    }

    let popupSide = 'right';
    let objectCenter = null;

    if (visible) {
      objectCenter = popupAnchor;
      const size = bboxSize || { halfW: 40, halfH: 40 };
      const popupPos = this.computePopupPosition(objectCenter, size);
      popupSide = popupPos.side;

      // Anchor deadzone: only retarget when the new anchor has shifted more
      // than POPUP_ANCHOR_DEADZONE_PX from the current target. This absorbs
      // per-frame detector noise so the 3D refraction doesn't shimmer when
      // the object / camera is at rest, without introducing any lag for
      // real motion (which blows straight past the deadzone).
      if (
        Math.abs(popupPos.x - this.target.popupX) > POPUP_ANCHOR_DEADZONE_PX
      ) {
        this.target.popupX = popupPos.x;
      }
      if (
        Math.abs(popupPos.y - this.target.popupY) > POPUP_ANCHOR_DEADZONE_PX
      ) {
        this.target.popupY = popupPos.y;
      }

      this.target.opacity = 1;
      // Entrance spring: on the frame we become visible, kick scale past 1.
      if (!this._wasVisible) {
        this.current.scale = 0.84;
        this._entranceTimer = 0.35;
        this.isHovering = false;
        this.target.tiltX = 0;
        this.target.tiltY = 0;
      }

      // TiltedCard hover + tilt: use the popup's logical (untransformed)
      // screen rect so the math is stable -- using getBoundingClientRect
      // would feed the current tilt back into the next frame's tilt target,
      // creating a drift. Tilt amplitude matches React Bits' default 14deg
      // and reads as "the cursor pulls the nearest corner forward". Hover
      // hit-test is done against the RENDERED position (post-parallax), so
      // that "does the cursor sit on the visible card" stays accurate when
      // parallax has nudged the card off its anchor.
      const hoverWidth = POPUP_WIDTH * this.current.scale;
      const hoverHalfW = hoverWidth * 0.5;
      const baseHoverHeight = this.popup.offsetHeight || POPUP_HEIGHT_ESTIMATE;
      const hoverHalfH = baseHoverHeight * this.current.scale * 0.5;
      // Use the previous frame's clamped render center. First frame after
      // becoming visible we don't have one yet, so fall back to raw anchor.
      const renderCenterX =
        this._renderX ?? this.current.popupX + this.currentParallax.x;
      const renderCenterY =
        this._renderY ?? this.current.popupY + this.currentParallax.y;
      const hoverDx = this.pointerClient.x - renderCenterX;
      const hoverDy = this.pointerClient.y - renderCenterY;
      const hoverInside =
        hoverHalfW > 0
        && hoverHalfH > 0
        && Math.abs(hoverDx) <= hoverHalfW
        && Math.abs(hoverDy) <= hoverHalfH;

      this.isHovering = hoverInside;

      if (hoverInside) {
        this.target.tiltX = -(hoverDy / hoverHalfH) * HOVER_ROTATE_AMPLITUDE_DEG;
        this.target.tiltY = (hoverDx / hoverHalfW) * HOVER_ROTATE_AMPLITUDE_DEG;
      } else {
        this.target.tiltX = 0;
        this.target.tiltY = 0;
      }

      const restScale = hoverInside ? HOVER_SCALE : 1;
      if (this._entranceTimer > 0) {
        this.target.scale = Math.max(restScale, 1.04);
        this._entranceTimer -= deltaTime;
        if (this._entranceTimer <= 0) this.target.scale = restScale;
      } else {
        this.target.scale = restScale;
      }
    } else {
      this.target.opacity = 0;
      this.target.scale = 0.92;
      this.target.tiltX = 0;
      this.target.tiltY = 0;
      this._entranceTimer = 0;
      this.isHovering = false;
    }
    this._wasVisible = visible;

    // Position damp is intentionally softer than before (9 -> 7): the EMA
    // upstream in Experience already absorbs detector noise, so the extra
    // room makes real movement visibly trail the object by a beat. Combined
    // with the upstream EMA (lambda 4) the overall response has a ~300ms
    // time constant -- the "soft, calm, floating" feel from the spec.
    this.current.popupX = damp(this.current.popupX, this.target.popupX, 7, deltaTime);
    this.current.popupY = damp(this.current.popupY, this.target.popupY, 7, deltaTime);
    this.current.opacity = damp(this.current.opacity, this.target.opacity, 8.4, deltaTime);
    this.current.scale = damp(this.current.scale, this.target.scale, 7, deltaTime);
    this.current.tiltX = damp(this.current.tiltX, this.target.tiltX, 7, deltaTime);
    this.current.tiltY = damp(this.current.tiltY, this.target.tiltY, 7, deltaTime);

    this._lastElapsedTime = elapsedTime;

    // Rendered (post-parallax) position. The parallax offset is applied
    // here ONLY: the target / damp chain stays on the pure anchor so the
    // popup is still rock-steady at rest, but head motion gives it that
    // subtle "it's anchored in world space, not glued to your eye" drift.
    //
    // Final safety-clamp: guarantee the visible card (at whatever scale the
    // entrance / hover spring is currently at) stays fully inside the
    // viewport even if the anchor + parallax sum would push it out. The
    // upstream anchor is already clamped with a parallax budget, so in
    // practice this only kicks in when the viewport is very small or the
    // popup is scaled above the max reserve -- a free belt on top of
    // getPopupSafeBounds's suspenders.
    const safeRender = this.getPopupRenderBounds();
    const renderX = Math.min(
      Math.max(this.current.popupX + this.currentParallax.x, safeRender.minX),
      safeRender.maxX
    );
    const renderY = Math.min(
      Math.max(this.current.popupY + this.currentParallax.y, safeRender.minY),
      safeRender.maxY
    );

    // Cache for getPopupScreenRect / isPointInPopup so the 3D glass and
    // hit-testing line up with the clamped on-screen position.
    this._renderX = renderX;
    this._renderY = renderY;

    this.popup.style.opacity = `${this.current.opacity}`;
    this.popup.style.transform =
      `translate3d(${renderX}px, ${renderY}px, 0) `
      + `translate(-50%, -50%) `
      + `rotateX(${this.current.tiltX}deg) rotateY(${this.current.tiltY}deg) `
      + `scale(${this.current.scale})`;
    this.popup.style.pointerEvents = this.current.opacity > 0.62 ? 'auto' : 'none';

    // Ping origin stays at the object's true screen position; connector
    // endpoint follows the popup's rendered (parallaxed) position, so the
    // line visibly elongates / shortens as the popup parallaxes -- a cheap
    // but effective "the popup is floating in front of the object" cue.
    this.renderPingAndConnector(
      objectCenter,
      { x: renderX, y: renderY },
      popupSide
    );
  }

  /**
   * Current screen-space rect of the popup card (CSS pixels). Used by the
   * 3D FluidGlassPanel to position itself so its refraction is precisely
   * behind the text. Returns null when the popup is effectively invisible
   * so callers can skip work / hide their overlay.
   */
  getPopupScreenRect() {
    if (this.current.opacity < 0.02) return null;

    const width = POPUP_WIDTH * this.current.scale;
    // Measure height from the live DOM so it tracks text wraps / localisation.
    // getBoundingClientRect already reflects the rendered transform, but we
    // want the "untransformed" logical size and compute position ourselves so
    // the 3D panel doesn't inherit the CSS 3D tilt (which would make it
    // shear on projection).
    const baseHeight = this.popup.offsetHeight || POPUP_HEIGHT_ESTIMATE;
    const height = baseHeight * this.current.scale;

    // Use the clamped rendered center so the 3D glass panel sits exactly
    // behind the visible DOM card -- not behind an unclamped "logical"
    // position that may have been shoved off-screen.
    const cx = this._renderX ?? this.current.popupX + this.currentParallax.x;
    const cy = this._renderY ?? this.current.popupY + this.currentParallax.y;

    return {
      x: cx - width / 2,
      y: cy - height / 2,
      width,
      height,
      opacity: this.current.opacity,
      // Passed through to FluidGlassPanel.setRotation so the 3D glass tilts
      // in lock-step with the CSS rotateX/Y on the DOM popup. Same units and
      // sign convention as CSS (degrees, CSS-positive = top away / right away).
      rotX: this.current.tiltX,
      rotY: this.current.tiltY
    };
  }

  /**
   * Screen-space hit-test used by Experience to decide whether to "pin" the
   * focused object (keep the popup alive) while the pointer sits on top of
   * the popup itself -- otherwise the pointer leaving the object's bbox
   * would unfocus and dismiss the popup even though the user is clearly
   * still interacting with it. Tests against the rendered (parallaxed)
   * rect so the hit-box lines up with what the user sees.
   */
  isPointInPopup(clientX, clientY) {
    if (this.current.opacity < 0.4) return false;
    const width = POPUP_WIDTH * this.current.scale;
    const baseHeight = this.popup.offsetHeight || POPUP_HEIGHT_ESTIMATE;
    const height = baseHeight * this.current.scale;
    // Hit-test against the clamped rendered position, same as the 3D glass.
    const cx = this._renderX ?? this.current.popupX + this.currentParallax.x;
    const cy = this._renderY ?? this.current.popupY + this.currentParallax.y;
    const left = cx - width / 2;
    const top = cy - height / 2;
    return (
      clientX >= left
      && clientX <= left + width
      && clientY >= top
      && clientY <= top + height
    );
  }

  dispose() {
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('pointermove', this.handlePointerMove);
    this.popup.removeEventListener('click', this.popupClickHandler);
    this.root.remove();
  }
}
