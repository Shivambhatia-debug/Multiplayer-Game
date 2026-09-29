// On-screen controls for phones and tablets: a floating stick on the left half of the
// screen, drag anywhere else to look, and thumb buttons for fire, jump, build and more.
const STICK_RADIUS = 56;

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
    this.lookSpeed = this.h.lookSpeed ?? 1.7;
    this.autoFire = this.h.autoFire ?? true;

    this.layer = el('div', 'touch-layer');
    this.base = el('div', 'stick-base', '<i class="stick-knob"></i>');
    this.knob = this.base.firstChild;
    this.layer.appendChild(this.base);
    // A faint resting stick shows new players where to put their thumb.
    this.hint = el('div', 'stick-hint', '<span>Move</span>');
    this.layer.appendChild(this.hint);
    root.prepend(this.layer);

    this.pad = el('div', 'touch-pad');
    this.fireBtn = el('button', 'tbtn fire', '<span>Fire</span>');
    this.jumpBtn = el('button', 'tbtn jump', '<span>Jump</span>');
    this.sprintBtn = el('button', 'tbtn sprint', '<span>Run</span>');
    this.pingBtn = el('button', 'tbtn mini ping', '📍');
    this.cancelBtn = el('button', 'tbtn mini cancel hidden', '✕');
    this.salvageBtn = el('button', 'tbtn wide salvage hidden', '<span>Salvage</span>');
    this.grenadeBtn = el('button', 'tbtn mini grenade', '💣');
    this.pad.append(this.fireBtn, this.jumpBtn, this.sprintBtn, this.pingBtn, this.cancelBtn, this.salvageBtn, this.grenadeBtn);
    root.appendChild(this.pad);

    this.topBar = el('div', 'touch-top');
    this.helpBtn = el('button', 'tbtn mini', '?');
    this.muteBtn = el('button', 'tbtn mini', '🔊');
    this.autoBtn = el('button', 'tbtn mini auto', '🎯');
    this.armoryBtn = el('button', 'tbtn mini', '⬆');
    this.emoteBtn = el('button', 'tbtn mini', '👋');
    this.autoBtn.title = 'Auto-fire';
    this.autoBtn.classList.toggle('on', this.autoFire);
    this.topBar.append(this.emoteBtn, this.armoryBtn, this.autoBtn, this.muteBtn, this.helpBtn);
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
    this.tap(this.grenadeBtn, () => this.h.onGrenade?.());
    this.tap(this.armoryBtn, () => this.h.onArmory?.());
    this.tap(this.emoteBtn, () => this.h.onEmote?.());
    this.tap(this.autoBtn, () => {
      this.autoFire = !this.autoFire;
      this.autoBtn.classList.toggle('on', this.autoFire);
      this.h.onAutoFire?.(this.autoFire);
    });
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
        this.hint.classList.add('off');
        this.moveStick(e);
      } else if (this.lookId === null) {
        this.lookId = e.pointerId;
        this.last = { x: e.clientX, y: e.clientY };
      }
    });
    layer.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.moveStick(e);
      else if (e.pointerId === this.lookId) {
        this.input.addLook((e.clientX - this.last.x) * this.lookSpeed, (e.clientY - this.last.y) * this.lookSpeed);
        this.last = { x: e.clientX, y: e.clientY };
      }
    });
    const end = (e) => {
      if (e.pointerId === this.stickId) {
        this.stickId = null;
        this.input.stick.x = this.input.stick.y = 0;
        this.base.classList.remove('on');
        this.hint.classList.remove('off');
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

  /** Shows the grenade cooldown in seconds (0 = ready). */
  setGrenade(wait) {
    const text = wait > 0 ? String(wait) : '💣';
    if (this.grenadeBtn.textContent !== text) this.grenadeBtn.textContent = text;
    this.grenadeBtn.classList.toggle('cooling', wait > 0);
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
    this.lookSpeed = this.h.lookSpeed ?? 1.7;
    this.autoFire = this.h.autoFire ?? true;
    this.stickId = null;
    this.lookId = null;
    this.input.stick.x = this.input.stick.y = 0;
    this.input.virtual.clear();
    this.sprintBtn.classList.remove('on');
    this.base.classList.remove('on');
  }
}
