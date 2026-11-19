/**
 * Fixed-timestep game loop ("Fix Your Timestep", G. Fiedler).
 *
 * Simulation always advances in exact `dt` steps, independent of display
 * rate, so physics is deterministic and stable. Leftover time becomes the
 * interpolation factor `alpha` passed to render. Frame time is clamped
 * (`maxFrame`) so a long stall (tab in background, debugger) runs a bounded
 * number of steps instead of a "spiral of death".
 */
export class FixedStep {
           dt        ;
           maxFrame        ;
  acc = 0;
  steps = 0;
  dropped = 0;

  constructor(hz = 60, maxFrame = 0.25) {
    this.dt = 1 / hz;
    this.maxFrame = maxFrame;
  }

  /**
   * Feed real elapsed seconds; runs update(dt) zero or more times.
   * Returns alpha in [0, 1) for render interpolation.
   */
  advance(elapsed        , update                      )         {
    if (elapsed > this.maxFrame) {
      this.dropped += elapsed - this.maxFrame;
      elapsed = this.maxFrame;
    }
    this.acc += Math.max(0, elapsed);
    // epsilon absorbs float drift so 1/60 * 60 frames == 60 steps exactly
    while (this.acc >= this.dt - 1e-9) {
      update(this.dt);
      this.acc -= this.dt;
      this.steps++;
    }
    if (this.acc < 0) this.acc = 0;
    return this.acc / this.dt;
  }
}

/** Seedable PRNG (mulberry32) so simulations and tests are reproducible. */
export function rng(seed        )               {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
