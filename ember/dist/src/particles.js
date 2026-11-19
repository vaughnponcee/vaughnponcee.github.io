/**
 * CPU particle pool with a fixed capacity: no allocation after construction.
 * Dead particles are swap-removed so live ones stay packed at the front.
 */
                                      

export class Particles {
           pos              ;
           vel              ;
           col              ;
           life              ;
           maxLife              ;
           size              ;
  count = 0;
  gravity = -9;
  drag = 1.5;

           capacity        ;

  constructor(capacity = 2048) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
  }

  /** Spawn n particles in a burst. Returns how many fit. */
  burst(at      , color      , n        , speed        , life = 0.8, size = 0.12, rnd = Math.random)         {
    let made = 0;
    for (let k = 0; k < n && this.count < this.capacity; k++) {
      const i = this.count++;
      // uniform direction on the sphere
      const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      const s = speed * (0.4 + rnd() * 0.6);
      this.pos.set(at, i * 3);
      this.vel[i * 3] = r * Math.cos(a) * s;
      this.vel[i * 3 + 1] = Math.abs(z) * s + speed * 0.3;
      this.vel[i * 3 + 2] = r * Math.sin(a) * s;
      this.col.set(color, i * 3);
      this.life[i] = this.maxLife[i] = life * (0.6 + rnd() * 0.4);
      this.size[i] = size;
      made++;
    }
    return made;
  }

  update(dt        )       {
    const damp = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.count; ) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const last = --this.count;
        if (i !== last) {
          this.pos.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.vel.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.col.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.life[i] = this.life[last];
          this.maxLife[i] = this.maxLife[last];
          this.size[i] = this.size[last];
        }
        continue; // re-check the particle swapped into slot i
      }
      const o = i * 3;
      this.vel[o + 1] += this.gravity * dt;
      this.vel[o] *= damp; this.vel[o + 1] *= damp; this.vel[o + 2] *= damp;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      if (this.pos[o + 1] < 0.05) { this.pos[o + 1] = 0.05; this.vel[o + 1] *= -0.4; }
      i++;
    }
  }
}
