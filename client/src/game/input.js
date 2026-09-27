// Keyboard + mouse state with pointer lock.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.lookX = 0;
    this.lookY = 0;
    this.locked = false;
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
      if (!this.locked) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked) {
        this.lock();
        return;
      }
      this.onClick(e.button);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.onLockChange(this.locked);
    });
  }

  lock() {
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p?.catch) p.catch(() => this.canvas.requestPointerLock());
    } catch {
      this.canvas.requestPointerLock();
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
