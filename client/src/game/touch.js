// On-screen controls for phones and tablets: a floating stick on the left half of the
// screen, drag anywhere else to look, and thumb buttons for fire, jump, build and more.
const STICK_RADIUS = 56;
const LOOK_SPEED = 1.7;

/** Keeps receiving a finger's events after it slides off the element (best effort). */
function capture(target, id) {
  try {
    target.setPointerCapture(id);
  } catch {
    // not an active pointer (e.g. synthetic events); events still arrive while over the element
  }
}

function el(tag, cls, html = '') {
  const e = document.createElement(tag);
  e.className = cls;
  e.innerHTML = html;
  return e;
}

export class TouchControls {
  constructor(root, input, handlers) {
    this.input = input;
    this.h = handlers;
    this.stickId = null;
    this.lookId = null;
    this.firing = false;

    this.layer = el('div', 'touch-layer');
    this.base = el('div', 'stick-base', '<i class="stick-knob"></i>');
    this.knob = this.base.firstChild;
    this.layer.appendChild(this.base);
    root.prepend(this.layer);

    this.pad = el('div', 'touch-pad');
    this.fireBtn = el('button', 'tbtn fire', '<span>Fire</span>');
    this.jumpBtn = el('button', 'tbtn jump', '<span>Jump</span>');
    this.sprintBtn = el('button', 'tbtn sprint', '<span>Run</span>');
    this.pingBtn = el('button', 'tbtn mini ping', '📍');
    this.cancelBtn = el('button', 'tbtn mini cancel hidden', '✕');
    this.salvageBtn = el('button', 'tbtn wide salvage hidden', '<span>Salvage</span>');
    this.pad.append(this.fireBtn, this.jumpBtn, this.sprintBtn, this.pingBtn, this.cancelBtn, this.salvageBtn);
    root.appendChild(this.pad);

    this.topBar = el('div', 'touch-top');
    this.helpBtn = el('button', 'tbtn mini', '?');
    this.muteBtn = el('button', 'tbtn mini', '🔊');
    this.topBar.append(this.muteBtn, this.helpBtn);
    root.appendChild(this.topBar);

    this.bindLayer();
    this.hold(this.fireBtn, () => {
      this.firing = true;
      this.h.onAction();
    }, () => (this.firing = false));
    this.hold(this.jumpBtn, () => input.virtual.add('jump'), () => input.virtual.delete('jump'));
    this.tap(this.sprintBtn, () => {
      const on = !input.virtual.has('sprint');
      if (on) input.virtual.add('sprint');
      else input.virtual.delete('sprint');
      this.sprintBtn.classList.toggle('on', on);
    });
    this.tap(this.pingBtn, () => this.h.onPing());
    this.tap(this.cancelBtn, () => this.h.onCancel());
    this.tap(this.salvageBtn, () => this.h.onSalvage());
    this.tap(this.helpBtn, () => this.h.onHelp());
    this.tap(this.muteBtn, () => {
      this.muteBtn.textContent = this.h.onMute() ? '🔇' : '🔊';
    });
  }

  /** A button that acts while held. Pointer capture keeps it pressed if the thumb slides. */
  hold(btn, down, up) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      capture(btn, e.pointerId);
      btn.classList.add('pressed');
      down();
    });
    const release = () => {
      btn.classList.remove('pressed');
      up();
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  tap(btn, fn) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    });
  }

  bindLayer() {
    const layer = this.layer;
    layer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(layer, e.pointerId);
      if (e.clientX < window.innerWidth * 0.42 && this.stickId === null) {
        this.stickId = e.pointerId;
        this.origin = { x: e.clientX, y: e.clientY };
        this.base.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
        this.base.classList.add('on');
        this.moveStick(e);
      } else if (this.lookId === null) {
        this.lookId = e.pointerId;
        this.last = { x: e.clientX, y: e.clientY };
      }
    });
    layer.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.moveStick(e);
      else if (e.pointerId === this.lookId) {
        this.input.addLook((e.clientX - this.last.x) * LOOK_SPEED, (e.clientY - this.last.y) * LOOK_SPEED);
        this.last = { x: e.clientX, y: e.clientY };
      }
    });
    const end = (e) => {
      if (e.pointerId === this.stickId) {
        this.stickId = null;
        this.input.stick.x = this.input.stick.y = 0;
        this.base.classList.remove('on');
        this.knob.style.transform = '';
      } else if (e.pointerId === this.lookId) {
        this.lookId = null;
      }
    };
    layer.addEventListener('pointerup', end);
    layer.addEventListener('pointercancel', end);
  }

  moveStick(e) {
    let dx = e.clientX - this.origin.x;
    let dy = e.clientY - this.origin.y;
    const d = Math.hypot(dx, dy);
    if (d > STICK_RADIUS) {
      // Drag the stick base along so the thumb never runs off it.
      const k = (d - STICK_RADIUS) / d;
      this.origin.x += dx * k;
      this.origin.y += dy * k;
      this.base.style.transform = `translate(${this.origin.x}px, ${this.origin.y}px)`;
      dx = e.clientX - this.origin.x;
      dy = e.clientY - this.origin.y;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // A small dead zone, then full range. Pushing to the rim sprints.
    const d2 = Math.hypot(dx, dy);
    const m = d2 / STICK_RADIUS;
    const mag = m < 0.12 ? 0 : Math.min(1, (m - 0.12) / 0.88);
    this.input.stick.x = d2 ? (dx / d2) * mag : 0;
    this.input.stick.y = d2 ? (dy / d2) * mag : 0;
    this.base.classList.toggle('run', mag > 0.93);
  }

  /** Called every frame with what the pilot can do right now. */
  update({ building, salvage, dead }) {
    this.fireBtn.firstChild.textContent = building ? 'Build' : 'Fire';
    this.fireBtn.classList.toggle('build', !!building);
    this.cancelBtn.classList.toggle('hidden', !building);
    this.salvageBtn.classList.toggle('hidden', !salvage || !!building);
    if (salvage) this.salvageBtn.firstChild.textContent = salvage;
    this.pad.classList.toggle('dead', !!dead);
  }

  reset() {
    this.firing = false;
    this.stickId = null;
    this.lookId = null;
    this.input.stick.x = this.input.stick.y = 0;
    this.input.virtual.clear();
    this.sprintBtn.classList.remove('on');
    this.base.classList.remove('on');
  }
}
