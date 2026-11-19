/**
 * Arena shooter built on the engine. Pure simulation, no DOM: the browser
 * entry (main.ts), the benchmark and the tests all drive this same code.
 */
import { World, indexOf,             } from "../src/ecs.js";
import { SpatialHash } from "../src/spatial.js";
import { rng } from "../src/loop.js";

export const TAG = { SHIP: 1, ASTEROID: 2, BULLET: 4, PARTICLE: 8 }         ;
const RADIUS = [0, 7, 13, 24];          // by asteroid size class 1..3
const SCORE = [0, 100, 50, 20];

                        
                                                                
                                                                                
 
export const NO_INPUT        = { left: false, right: false, thrust: false, fire: false };

                        
                                                                          
                                                                    
 

export class Game {
           w       ;
           W        ;
           H        ;
           rand              ;
           grid             ;
  // components
           Pos;
           Vel;
           Body;
           Life;
           Ast;
           Spin;
  ship         = -1;
  score = 0;
  lives = 3;
  invuln = 0;
  cooldown = 0;
  shipAngle = -Math.PI / 2;
  targetAsteroids        ;
  time = 0;
  stats        = { entities: 0, asteroids: 0, bullets: 0, particles: 0, pairsChecked: 0, collisions: 0, bruteForcePairs: 0 };

  constructor(width = 1280, height = 720, seed = 1, targetAsteroids = 460) {
    this.W = width;
    this.H = height;
    this.rand = rng(seed);
    this.w = new World(2048);
    this.grid = new SpatialHash(48, 4096, 8192);
    this.targetAsteroids = targetAsteroids;
    this.Pos = this.w.defineComponent("Pos", { x: Float32Array, y: Float32Array, px: Float32Array, py: Float32Array });
    this.Vel = this.w.defineComponent("Vel", { x: Float32Array, y: Float32Array });
    this.Body = this.w.defineComponent("Body", { r: Float32Array, mass: Float32Array });
    this.Life = this.w.defineComponent("Life", { t: Float32Array, max: Float32Array });
    this.Ast = this.w.defineComponent("Ast", { size: Uint8Array, shape: Uint16Array });
    this.Spin = this.w.defineComponent("Spin", { a: Float32Array, v: Float32Array });
    this.spawnShip();
    // start with the size mix a broken-up field has (1 large : 2 medium : 3 small),
    // scattered over the arena but never on top of the ship
    while (this.countTag(TAG.ASTEROID) < targetAsteroids) this.spawnScattered(this.pickSize());
  }

  /** 1/6 large, 1/3 medium, 1/2 small: ~25% arena coverage at the default target. */
  pickSize()         {
    const u = this.rand();
    return u < 1 / 6 ? 3 : u < 0.5 ? 2 : 1;
  }

  spawnScattered(size        )       {
    const r = this.rand;
    let x = 0, y = 0;
    for (let tries = 0; tries < 20; tries++) {
      x = r() * this.W;
      y = r() * this.H;
      if (Math.hypot(x - this.W / 2, y - this.H / 2) > 160) break;
    }
    const sp = 20 + r() * 50, a = r() * Math.PI * 2;
    this.spawnAsteroid(x, y, size, Math.cos(a) * sp, Math.sin(a) * sp);
  }

          countTag(tag        )         {
    let n = 0;
    this.w.query([this.Pos], (i) => { if (this.w.tags[i] & tag) n++; });
    return n;
  }

  spawnShip()       {
    const e = this.w.create();
    this.w.tags[indexOf(e)] = TAG.SHIP;
    this.w.add(e, this.Pos, { x: this.W / 2, y: this.H / 2, px: this.W / 2, py: this.H / 2 });
    this.w.add(e, this.Vel);
    this.w.add(e, this.Body, { r: 12, mass: 1 });
    this.ship = e;
    this.invuln = 2.5;
  }

  spawnAsteroid(x        , y        , size        , vx        , vy        )         {
    const e = this.w.create();
    this.w.tags[indexOf(e)] = TAG.ASTEROID;
    this.w.add(e, this.Pos, { x, y, px: x, py: y });
    this.w.add(e, this.Vel, { x: vx, y: vy });
    const r = RADIUS[size];
    this.w.add(e, this.Body, { r, mass: r * r });
    this.w.add(e, this.Ast, { size, shape: Math.floor(this.rand() * 65535) });
    this.w.add(e, this.Spin, { a: this.rand() * 6.28, v: (this.rand() - 0.5) * 2 });
    return e;
  }

  spawnAsteroidAtEdge(size        )       {
    const r = this.rand;
    const edge = Math.floor(r() * 4);
    const x = edge === 0 ? 0 : edge === 1 ? this.W : r() * this.W;
    const y = edge === 2 ? 0 : edge === 3 ? this.H : r() * this.H;
    const sp = 25 + r() * 60, a = r() * Math.PI * 2;
    // spawns enter from the arena edge so they never pop in on top of the ship
    this.spawnAsteroid(x, y, size, Math.cos(a) * sp, Math.sin(a) * sp);
  }

          spawnBullet()       {
    const s = indexOf(this.ship);
    const P = this.Pos.data, V = this.Vel.data;
    const dx = Math.cos(this.shipAngle), dy = Math.sin(this.shipAngle);
    const e = this.w.create();
    this.w.tags[indexOf(e)] = TAG.BULLET;
    const x = P.x[s] + dx * 14, y = P.y[s] + dy * 14;
    this.w.add(e, this.Pos, { x, y, px: x, py: y });
    this.w.add(e, this.Vel, { x: V.x[s] + dx * 520, y: V.y[s] + dy * 520 });
    this.w.add(e, this.Body, { r: 2, mass: 0.1 });
    this.w.add(e, this.Life, { t: 1.1, max: 1.1 });
  }

  burst(x        , y        , n        , speed        )       {
    for (let k = 0; k < n; k++) {
      const a = this.rand() * Math.PI * 2, sp = speed * (0.3 + this.rand());
      const e = this.w.create();
      this.w.tags[indexOf(e)] = TAG.PARTICLE;
      this.w.add(e, this.Pos, { x, y, px: x, py: y });
      this.w.add(e, this.Vel, { x: Math.cos(a) * sp, y: Math.sin(a) * sp });
      const life = 0.4 + this.rand() * 0.6;
      this.w.add(e, this.Life, { t: life, max: life });
    }
  }

  // -------------------------------------------------------------- systems
          sysShip(dt        , input       )       {
    if (!this.w.alive(this.ship)) return;
    const s = indexOf(this.ship);
    const V = this.Vel.data, P = this.Pos.data;
    if (input.aimX !== undefined && input.aimY !== undefined) {
      const want = Math.atan2(input.aimY - P.y[s], input.aimX - P.x[s]);
      let d = want - this.shipAngle;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.shipAngle += Math.max(-7 * dt, Math.min(7 * dt, d));
    }
    if (input.left) this.shipAngle -= 4.2 * dt;
    if (input.right) this.shipAngle += 4.2 * dt;
    if (input.thrust) {
      V.x[s] += Math.cos(this.shipAngle) * 380 * dt;
      V.y[s] += Math.sin(this.shipAngle) * 380 * dt;
      if (this.rand() < 0.6) this.burst(P.x[s] - Math.cos(this.shipAngle) * 12, P.y[s] - Math.sin(this.shipAngle) * 12, 1, 60);
    }
    const drag = Math.pow(0.35, dt);
    V.x[s] *= drag;
    V.y[s] *= drag;
    this.cooldown -= dt;
    if (input.fire && this.cooldown <= 0) {
      this.spawnBullet();
      this.cooldown = 0.09;
    }
    this.invuln = Math.max(0, this.invuln - dt);
  }

          sysMove(dt        )       {
    const P = this.Pos.data, V = this.Vel.data, W = this.W, H = this.H;
    this.w.query([this.Pos, this.Vel], (i) => {
      P.px[i] = P.x[i];
      P.py[i] = P.y[i];
      let x = P.x[i] + V.x[i] * dt, y = P.y[i] + V.y[i] * dt;
      // toroidal arena; snap prev too so interpolation doesn't streak across the screen
      if (x < 0) { x += W; P.px[i] += W; } else if (x >= W) { x -= W; P.px[i] -= W; }
      if (y < 0) { y += H; P.py[i] += H; } else if (y >= H) { y -= H; P.py[i] -= H; }
      P.x[i] = x;
      P.y[i] = y;
    });
    const S = this.Spin.data;
    this.w.query([this.Spin], (i) => { S.a[i] += S.v[i] * dt; });
  }

          sysLife(dt        )       {
    const L = this.Life.data;
    this.w.query([this.Life], (i) => {
      L.t[i] -= dt;
      if (L.t[i] <= 0) this.w.defer.destroy(this.w.entityAt(i));
    });
  }

          sysCollide()       {
    const g = this.grid, P = this.Pos.data, B = this.Body.data, V = this.Vel.data, tags = this.w.tags;
    g.clear();
    let bodies = 0;
    this.w.query([this.Pos, this.Body], (i) => {
      const r = B.r[i];
      g.insert(i, P.x[i] - r, P.y[i] - r, P.x[i] + r, P.y[i] + r);
      bodies++;
    });
    this.stats.bruteForcePairs = (bodies * (bodies - 1)) / 2;
    let hits = 0;
    const dead = new Set        ();
    g.pairs((a, b) => {
      if (dead.has(a) || dead.has(b)) return;
      const dx = P.x[b] - P.x[a], dy = P.y[b] - P.y[a];
      const rr = B.r[a] + B.r[b];
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr) return;   // AABBs overlap but circles don't
      hits++;
      const ta = tags[a], tb = tags[b];
      const kinds = ta | tb;
      if (kinds === (TAG.BULLET | TAG.ASTEROID)) {
        const ast = ta === TAG.ASTEROID ? a : b, bul = ast === a ? b : a;
        dead.add(ast);
        dead.add(bul);
        this.breakAsteroid(ast);
        this.w.defer.destroy(this.w.entityAt(bul));
      } else if (kinds === (TAG.SHIP | TAG.ASTEROID)) {
        if (this.invuln > 0) return;
        const s = ta === TAG.SHIP ? a : b;
        dead.add(s);
        this.burst(P.x[s], P.y[s], 60, 220);
        this.w.defer.destroy(this.w.entityAt(s));
        this.lives--;
      } else if (ta === TAG.ASTEROID && tb === TAG.ASTEROID) {
        // elastic collision of two discs along the contact normal
        const d = Math.sqrt(d2) || 1e-6, nx = dx / d, ny = dy / d;
        const rv = (V.x[b] - V.x[a]) * nx + (V.y[b] - V.y[a]) * ny;
        if (rv < 0) {
          const ma = B.mass[a], mb = B.mass[b], j = (-2 * rv) / (1 / ma + 1 / mb);
          V.x[a] -= (j / ma) * nx; V.y[a] -= (j / ma) * ny;
          V.x[b] += (j / mb) * nx; V.y[b] += (j / mb) * ny;
        }
        const push = (rr - d) / 2;   // separate so they don't stick
        P.x[a] -= nx * push; P.y[a] -= ny * push;
        P.x[b] += nx * push; P.y[b] += ny * push;
      }
    });
    this.stats.pairsChecked = g.checks;
    this.stats.collisions = hits;
  }

          breakAsteroid(i        )       {
    const A = this.Ast.data, P = this.Pos.data, V = this.Vel.data;
    const size = A.size[i];
    this.score += SCORE[size];
    this.burst(P.x[i], P.y[i], 6 + size * 4, 90);
    if (size > 1) {
      for (let k = 0; k < 2; k++) {
        const a = this.rand() * Math.PI * 2, sp = 40 + this.rand() * 70;
        this.spawnAsteroid(P.x[i], P.y[i], size - 1, V.x[i] + Math.cos(a) * sp, V.y[i] + Math.sin(a) * sp);
      }
    }
    this.w.defer.destroy(this.w.entityAt(i));
  }

          sysSpawner()       {
    if (this.Ast.set.size < this.targetAsteroids) this.spawnAsteroidAtEdge(this.pickSize());
    if (!this.w.alive(this.ship) && this.lives > 0 && this.respawnTimer() <= 0) this.spawnShip();
  }

          deadFor = 0;
          respawnTimer()         {
    return 1.5 - this.deadFor;
  }

  step(dt        , input        = NO_INPUT)       {
    this.time += dt;
    this.sysShip(dt, input);
    this.sysMove(dt);
    this.sysLife(dt);
    this.sysCollide();
    this.w.flush();
    this.deadFor = this.w.alive(this.ship) ? 0 : this.deadFor + dt;
    this.sysSpawner();
    const t = this.w.tags;
    let a = 0, b = 0, p = 0;
    this.w.query([this.Pos], (i) => {
      const g = t[i];
      if (g === TAG.ASTEROID) a++; else if (g === TAG.BULLET) b++; else if (g === TAG.PARTICLE) p++;
    });
    this.stats.entities = this.w.count;
    this.stats.asteroids = a;
    this.stats.bullets = b;
    this.stats.particles = p;
  }
}
