/**
 * Keyboard, mouse (with pointer lock) and gamepad, polled once per frame.
 * "pressed" means went down since the last endFrame(), so a tap that starts
 * and ends between two frames is still seen.
 */
export class Input {
          down = new Set        ();
          hit = new Set        ();
  mouseDX = 0;
  mouseDY = 0;
  locked = false;

  constructor(target             ) {
    addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      this.hit.add(e.code);
      if (["Space", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
    });
    addEventListener("keyup", (e) => this.down.delete(e.code));
    addEventListener("blur", () => this.down.clear());
    target.addEventListener("mousedown", (e) => {
      this.hit.add("Mouse" + e.button);
      this.down.add("Mouse" + e.button);
      if (!this.locked) target.requestPointerLock?.();
    });
    addEventListener("mouseup", (e) => this.down.delete("Mouse" + e.button));
    document.addEventListener("pointerlockchange", () => { this.locked = document.pointerLockElement === target; });
    addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
  }

  held(code        )          { return this.down.has(code); }
  pressed(code        )          { return this.hit.has(code); }

  /** Movement axes in [-1,1] from WASD/arrows, or the left gamepad stick. */
  axes()                           {
    let x = 0, y = 0;
    if (this.held("KeyA") || this.held("ArrowLeft")) x -= 1;
    if (this.held("KeyD") || this.held("ArrowRight")) x += 1;
    if (this.held("KeyW") || this.held("ArrowUp")) y += 1;
    if (this.held("KeyS") || this.held("ArrowDown")) y -= 1;
    const pad = navigator.getGamepads?.()[0];
    if (pad && Math.hypot(pad.axes[0], pad.axes[1]) > 0.15) { x = pad.axes[0]; y = -pad.axes[1]; }
    const l = Math.hypot(x, y);
    return l > 1 ? { x: x / l, y: y / l } : { x, y };
  }

  padButton(i        )          { return !!navigator.getGamepads?.()[0]?.buttons[i]?.pressed; }

  endFrame()       {
    this.hit.clear();
    this.mouseDX = this.mouseDY = 0;
  }
}
