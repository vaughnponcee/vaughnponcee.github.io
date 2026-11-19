/**
 * Fixed-timestep loop (Glenn Fiedler's "Fix Your Timestep"). Simulation runs
 * at a constant rate regardless of display refresh; render gets an alpha in
 * [0,1) to interpolate between the last two simulation states.
 */
export class FixedLoop {
  acc = 0;
  steps = 0;
  /** Frames where the step cap was hit and time was dropped (spiral of death guard). */
  dropped = 0;

           dt        ;
           maxSteps        ;

  constructor(dt = 1 / 60, maxSteps = 5) {
    this.dt = dt;
    this.maxSteps = maxSteps;
  }

  /** Advance by real elapsed seconds; calls step() zero or more times. Returns alpha. */
  advance(elapsed        , step                      )         {
    this.acc += Math.min(Math.max(elapsed, 0), 0.25);
    let n = 0;
    while (this.acc >= this.dt) {
      if (n === this.maxSteps) { this.acc = 0; this.dropped++; break; }
      step(this.dt);
      this.acc -= this.dt;
      this.steps++;
      n++;
    }
    return this.acc / this.dt;
  }
}
