// Keyboard + mouse state with pointer lock. Where pointer lock is blocked (for example
// inside a sandboxed iframe) it falls back to right-drag to look, left-click to act.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.lookX = 0;
    this.lookY = 0;
    this.locked = false;
    this.dragMode = false;
    this.onKey = () => {};
    this.onClick = () => {};
    this.onLockChange = () => {};
    this.enabled = false;

    window.addEventListener('keydown', (e) => {
      if (!this.enabled || e.target instanceof HTMLInputElement) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.onKey(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      const dragging = this.dragMode && this.enabled && (e.buttons & 2);
      if (!this.locked && !dragging) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (this.dragMode) {
        if (e.button === 0) this.onClick(0);
        return;
      }
      if (!this.locked) {
        this.lock();
        return;
      }
      this.onClick(e.button);
    });
    document.addEventListener('pointerlockerror', () => this.fallBackToDrag());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.onLockChange(this.locked);
    });
  }

  get active() {
    return this.locked || this.dragMode;
  }

  fallBackToDrag() {
    if (this.dragMode) return;
    this.dragMode = true;
    this.onLockChange(false);
  }

  lock() {
    if (!this.canvas.requestPointerLock) {
      this.fallBackToDrag();
      return;
    }
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p?.catch) {
        p.catch(() => {
          const retry = this.canvas.requestPointerLock();
          if (retry?.catch) retry.catch(() => this.fallBackToDrag());
        });
      }
    } catch {
      this.fallBackToDrag();
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  consumeLook() {
    const out = [this.lookX, this.lookY];
    this.lookX = 0;
    this.lookY = 0;
    return out;
  }
}
