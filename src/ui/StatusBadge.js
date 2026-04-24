/**
 * Glassmorphism status badge pinned to the top-left corner. Visually consistent
 * with the focus popup so the HUD reads as one cohesive surface.
 *
 * States: 'idle' | 'loading' | 'ready' | 'error'
 */
export class StatusBadge {
  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'attrax-status-badge';
    this.element.dataset.state = 'idle';

    this.labelEl = document.createElement('span');
    this.labelEl.className = 'label';
    this.labelEl.textContent = 'STATUS';

    this.valueEl = document.createElement('span');
    this.valueEl.className = 'value';
    this.valueEl.textContent = 'idle';

    this.element.append(this.labelEl, this.valueEl);
    document.body.appendChild(this.element);
  }

  set(state, value, label) {
    if (state) {
      this.element.dataset.state = state;
    }
    if (typeof value === 'string') {
      this.valueEl.textContent = value;
    }
    if (typeof label === 'string') {
      this.labelEl.textContent = label;
    }
  }

  dispose() {
    this.element.remove();
  }
}
