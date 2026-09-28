// Keyboard + mouse state with pointer lock. Where pointer lock is blocked (for example
// inside a sandboxed iframe) it falls back to right-drag to look, left-click to act.
// On touch screens the on-screen controls (touch.js) feed the same state.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.touchMode = false;
    this.stick = { x: 0, y: 0 };
    this.virtual = new Set();
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
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.virtual.clear();
      this.stick.x = this.stick.y = 0;
    });
    document.addEventListener('mousemove', (e) => {
      const dragging = this.dragMode && this.enabled && (e.buttons & 2);
      if (!this.locked && !dragging) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.touchMode) return;
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
    return this.locked || this.dragMode || this.touchMode;
  }

  /** Forward / strafe in [-1, 1], from the keyboard or the on-screen stick. */
  moveAxis() {
    let f = (this.down('KeyW', 'ArrowUp') ? 1 : 0) - (this.down('KeyS', 'ArrowDown') ? 1 : 0);
    let s = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0);
    if (this.stick.x || this.stick.y) {
      f = -this.stick.y;
      s = this.stick.x;
    }
    return [f, s];
  }

  sprinting() {
    return this.down('ShiftLeft', 'ShiftRight') || this.virtual.has('sprint') || Math.hypot(this.stick.x, this.stick.y) > 0.93;
  }

  jumping() {
    return this.down('Space') || this.virtual.has('jump');
  }

  addLook(dx, dy) {
    this.lookX += dx;
    this.lookY += dy;
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
