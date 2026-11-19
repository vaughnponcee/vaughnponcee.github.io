/**
 * Rigid body physics: spheres and oriented boxes that rotate and tumble.
 *
 * Fixed step, semi-implicit Euler for position and orientation, hashed grid
 * broadphase, separating-axis box-box tests with multi-point contacts, and a
 * sequential-impulse solver with angular terms, restitution and Coulomb
 * friction (accumulated and clamped per contact point). A final shock
 * propagation sweep keeps stacks standing, and resting bodies go to sleep.
 * Bodies with fixedRotation (characters) never spin.
 */
                                            

                                                                                

                       
             
            
            
                                                  
            
                                                             
               
               
                                    
                  
                                                                              
                   
                      
                   
                                                 
                   
                       
                                                                                
                
               
                    
                    
                     
                                                                              
                 
                                                    
               
                      
                                 
                      
                 
 

                                                                                          
                                                                            

                              
            
               
                
             
             
                
                                                            
                          
                       
                    
                    
                        
                 
                
                 
 

const SLEEP_SPEED = 0.1;
const SLEEP_SPIN = 0.15;
const SLEEP_TIME = 0.6;

// ---- small vector helpers (allocation is fine here; hot loops inline) ----
const sub = (a      , b      )       => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a      , b      ) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a      , b      )       => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Rotate v by q. */
export function qrot(q      , v      )       {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}
/** Rotate v by the inverse of q. */
export function qrotInv(q      , v      )       { return qrot([-q[0], -q[1], -q[2], q[3]], v); }

let stamp = 0;
/** Box axes in world space, computed once per body per step. */
function axes(b      )                     {
  if (b.cacheStamp !== stamp || !b.cacheAxes) {
    b.cacheStamp = stamp;
    b.cacheAxes = [qrot(b.rot, [1, 0, 0]), qrot(b.rot, [0, 1, 0]), qrot(b.rot, [0, 0, 1])];
    b.cacheVerts = undefined;
  }
  return b.cacheAxes;
}

/** World-space inverse inertia applied to a vector: R * diag(invI) * R^T * v. */
function applyInvInertia(b      , v      )       {
  const l = qrotInv(b.rot, v), I = b.invInertia;
  return qrot(b.rot, [l[0] * I[0], l[1] * I[1], l[2] * I[2]]);
}

function boxVertices(b      )         {
  const [X, Y, Z] = axes(b);
  if (b.cacheVerts) return b.cacheVerts;
  const h = (b.shape                  ).half, out         = [], p = b.pos;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const a = sx * h[0], c = sy * h[1], e = sz * h[2];
    out.push([p[0] + X[0] * a + Y[0] * c + Z[0] * e, p[1] + X[1] * a + Y[1] * c + Z[1] * e, p[2] + X[2] * a + Y[2] * c + Z[2] * e]);
  }
  b.cacheVerts = out;
  return out;
}

function insideBox(b      , p      , tol        )          {
  const [X, Y, Z] = axes(b), h = (b.shape                  ).half;
  const dx = p[0] - b.pos[0], dy = p[1] - b.pos[1], dz = p[2] - b.pos[2];
  return Math.abs(X[0] * dx + X[1] * dy + X[2] * dz) <= h[0] + tol &&
    Math.abs(Y[0] * dx + Y[1] * dy + Y[2] * dz) <= h[1] + tol &&
    Math.abs(Z[0] * dx + Z[1] * dy + Z[2] * dz) <= h[2] + tol;
}

function sphereSphere(a      , b      )                 {
  const ra = (a.shape                 ).r, rb = (b.shape                 ).r;
  const d = sub(b.pos, a.pos), dist = Math.hypot(d[0], d[1], d[2]), rs = ra + rb;
  if (dist >= rs) return null;
  const n       = dist > 1e-9 ? [d[0] / dist, d[1] / dist, d[2] / dist] : [0, 1, 0];
  return { a, b, normal: n, depth: rs - dist, points: [[a.pos[0] + n[0] * ra, a.pos[1] + n[1] * ra, a.pos[2] + n[2] * ra]] };
}

/** Sphere s vs box x. Returned normal points from s to x. */
function sphereBox(s      , x      )                                                      {
  const r = (s.shape                 ).r, h = (x.shape                  ).half;
  const rel = qrotInv(x.rot, sub(s.pos, x.pos));
  const cl       = [Math.max(-h[0], Math.min(h[0], rel[0])), Math.max(-h[1], Math.min(h[1], rel[1])), Math.max(-h[2], Math.min(h[2], rel[2]))];
  let nLocal      , depth        ;
  if (cl[0] === rel[0] && cl[1] === rel[1] && cl[2] === rel[2]) {
    // centre inside the box: push out along the axis of least penetration
    let best = Infinity, ax = 0;
    for (let i = 0; i < 3; i++) { const o = h[i] - Math.abs(rel[i]); if (o < best) { best = o; ax = i; } }
    nLocal = [0, 0, 0];
    nLocal[ax] = rel[ax] < 0 ? -1 : 1;
    depth = best + r;
    cl[ax] = nLocal[ax] * h[ax];
  } else {
    const d = sub(rel, cl), dist = Math.hypot(d[0], d[1], d[2]);
    if (dist >= r) return null;
    nLocal = [d[0] / dist, d[1] / dist, d[2] / dist];
    depth = r - dist;
  }
  const outward = qrot(x.rot, nLocal); // box -> sphere
  const pw = qrot(x.rot, cl);
  return { normal: [-outward[0], -outward[1], -outward[2]], depth, point: [x.pos[0] + pw[0], x.pos[1] + pw[1], x.pos[2] + pw[2]] };
}

function boxBox(a      , b      )                 {
  const A = axes(a), B = axes(b);
  const ha = (a.shape                  ).half, hb = (b.shape                  ).half;
  const d = sub(b.pos, a.pos);
  const project = (h      , ax                    , n      ) => h[0] * Math.abs(dot(ax[0], n)) + h[1] * Math.abs(dot(ax[1], n)) + h[2] * Math.abs(dot(ax[2], n));
  let best = Infinity, bestN       = [0, 1, 0], faceBest = Infinity, faceN       = [0, 1, 0];
  const test = (n      , isFace         )          => {
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-6) return true; // parallel edges give no axis
    const u       = [n[0] / l, n[1] / l, n[2] / l];
    const o = project(ha, A, u) + project(hb, B, u) - Math.abs(dot(d, u));
    if (o < 0) return false;
    const dir       = dot(d, u) < 0 ? [-u[0], -u[1], -u[2]] : u;
    if (isFace && o < faceBest) { faceBest = o; faceN = dir; }
    if (o < best) { best = o; bestN = dir; }
    return true;
  };
  for (const n of A) if (!test(n, true)) return null;
  for (const n of B) if (!test(n, true)) return null;
  for (const x of A) for (const y of B) if (!test(cross(x, y), false)) return null;
  // prefer a face axis unless an edge axis is clearly shallower: stable resting contacts
  let normal = bestN, depth = best;
  if (faceBest <= best * 1.05 + 0.001) { normal = faceN; depth = faceBest; }

  const tol = 0.02 + depth;
  const points         = [];
  for (const v of boxVertices(a)) if (insideBox(b, v, tol)) points.push(v);
  for (const v of boxVertices(b)) if (insideBox(a, v, tol)) points.push(v);
  if (!points.length) {
    // edge-edge: midpoint of the two deepest supports
    const sa = support(a, normal), sb = support(b, [-normal[0], -normal[1], -normal[2]]);
    points.push([(sa[0] + sb[0]) / 2, (sa[1] + sb[1]) / 2, (sa[2] + sb[2]) / 2]);
  }
  // cap the manifold at 4 points spread over the patch (keeps the solver cheap)
  while (points.length > 4) {
    let worst = 0, wi = 0;
    for (let i = 0; i < points.length; i++) {
      let near = Infinity;
      for (let j = 0; j < points.length; j++) if (j !== i) near = Math.min(near, Math.hypot(...sub(points[i], points[j])));
      if (i === 0 || near < worst) { worst = near; wi = i; }
    }
    points.splice(wi, 1);
  }
  return { a, b, normal, depth, points };
}

function support(b      , dir      )       {
  let best = -Infinity, out       = b.pos;
  for (const v of boxVertices(b)) { const s = dot(v, dir); if (s > best) { best = s; out = v; } }
  return out;
}

/** Narrowphase. Normal points from a to b; points are world-space contact points. */
export function collide(a      , b      )                 {
  const sa = a.shape.kind, sb = b.shape.kind;
  if (sa === "sphere" && sb === "sphere") return sphereSphere(a, b);
  if (sa === "box" && sb === "box") return boxBox(a, b);
  if (sa === "sphere") {
    const r = sphereBox(a, b);
    return r && { a, b, normal: r.normal, depth: r.depth, points: [r.point] };
  }
  const r = sphereBox(b, a);
  return r && { a, b, normal: [-r.normal[0], -r.normal[1], -r.normal[2]], depth: r.depth, points: [r.point] };
}

const pairKey = (a      , b      ) => Math.min(a.id, b.id) * 1048576 + Math.max(a.id, b.id);

                  
             
                         
                                                         
                  
                 
                         
 

export class PhysicsWorld {
  bodies         = [];
  gravity       = [0, -24, 0];
  velocityIterations = 10;
  iterations = 6;
  cell = 4;
  /** Fraction of angular velocity kept per second (rolling resistance and air drag). */
  angularDamping = 0.15;
  /** Extra spin damping per second while touching something (rolling resistance). */
  rollingResistance = 1.5;
  triggerEvents            = [];
  stats = { pairs: 0, contacts: 0, sleeping: 0 };
          nextId = 1;
          grid = new Map                  ();
  /** Last step's accumulated impulses per body pair, for warm starting. */
          cache = new Map                                                             ();
          box = new Float64Array(0);
          cmin = new Int32Array(0);

  add(o             )       {
    const mass = o.mass && o.mass > 0 ? o.mass : 0;
    let invI       = [0, 0, 0];
    if (mass > 0 && !o.fixedRotation) {
      if (o.shape.kind === "sphere") { const I = 0.4 * mass * o.shape.r * o.shape.r; invI = [1 / I, 1 / I, 1 / I]; }
      else {
        const [x, y, z] = o.shape.half.map((h) => 2 * h);
        invI = [12 / (mass * (y * y + z * z)), 12 / (mass * (x * x + z * z)), 12 / (mass * (x * x + y * y))];
      }
    }
    const b       = {
      id: this.nextId++,
      pos: [...o.pos]        ,
      vel: o.vel ? ([...o.vel]        ) : [0, 0, 0],
      rot: o.rot ? ([...o.rot]        ) : [0, 0, 0, 1],
      angVel: o.angVel ? ([...o.angVel]        ) : [0, 0, 0],
      shape: o.shape,
      invMass: mass > 0 ? 1 / mass : 0,
      invInertia: invI,
      restitution: o.restitution ?? 0.1,
      friction: o.friction ?? 0.5,
      trigger: o.trigger ?? false,
      gravityScale: o.gravityScale ?? 1,
      layer: o.layer ?? 1,
      mask: o.mask ?? 0xffff,
      grounded: false,
      sleeping: false,
      sleepTimer: 0,
      motion: 10,
      slot: 0,
      user: o.user,
    };
    this.bodies.push(b);
    return b;
  }

  remove(b      )       {
    const i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
  }

  wake(b      )       { b.sleeping = false; b.sleepTimer = 0; b.motion = 10; }

  /** Candidate pairs from a hashed uniform grid. Each pair appears once. */
  broadphase()                 {
    const grid = this.grid;
    for (const list of grid.values()) list.length = 0;
    if (grid.size > 20000) grid.clear();
    const inv = 1 / this.cell;
    const pairs                 = [];
    const n = this.bodies.length;
    if (this.box.length < n * 6) { this.box = new Float64Array(n * 12); this.cmin = new Int32Array(n * 6); }
    const box = this.box, cmin = this.cmin;
    const big           = [];
    for (let i = 0; i < n; i++) {
      const b = this.bodies[i];
      b.slot = i;
      const p = b.pos, o = i * 6;
      let ex        , ey        , ez        ;
      if (b.shape.kind === "sphere") ex = ey = ez = b.shape.r;
      else {
        // world extents of a rotated box: |R| * half
        const h = b.shape.half, [X, Y, Z] = axes(b);
        ex = Math.abs(X[0]) * h[0] + Math.abs(Y[0]) * h[1] + Math.abs(Z[0]) * h[2];
        ey = Math.abs(X[1]) * h[0] + Math.abs(Y[1]) * h[1] + Math.abs(Z[1]) * h[2];
        ez = Math.abs(X[2]) * h[0] + Math.abs(Y[2]) * h[1] + Math.abs(Z[2]) * h[2];
      }
      box[o] = p[0] - ex; box[o + 1] = p[1] - ey; box[o + 2] = p[2] - ez; box[o + 3] = p[0] + ex; box[o + 4] = p[1] + ey; box[o + 5] = p[2] + ez;
    }
    for (let i = 0; i < n; i++) {
      const b = this.bodies[i], o = i * 6;
      const ax = Math.floor(box[o] * inv), ay = Math.floor(box[o + 1] * inv), az = Math.floor(box[o + 2] * inv);
      const bx = Math.floor(box[o + 3] * inv), by = Math.floor(box[o + 4] * inv), bz = Math.floor(box[o + 5] * inv);
      cmin[i * 3] = ax; cmin[i * 3 + 1] = ay; cmin[i * 3 + 2] = az;
      if ((bx - ax + 1) * (by - ay + 1) * (bz - az + 1) > 64) { big.push(i); continue; }
      for (let x = ax; x <= bx; x++)
        for (let y = ay; y <= by; y++)
          for (let z = az; z <= bz; z++) {
            const k = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) | 0;
            let list = grid.get(k);
            if (!list) { list = []; grid.set(k, list); }
            for (let m = 0; m < list.length; m++) {
              const j = list[m];
              // report each pair once: only from the lowest cell both bodies share
              if (Math.max(ax, cmin[j * 3]) !== x || Math.max(ay, cmin[j * 3 + 1]) !== y || Math.max(az, cmin[j * 3 + 2]) !== z) continue;
              this.tryPair(b, this.bodies[j], pairs);
            }
            list.push(i);
          }
    }
    for (const i of big) {
      const b = this.bodies[i];
      for (let j = 0; j < n; j++) if (j !== i && !(big.includes(j) && j < i)) this.tryPair(b, this.bodies[j], pairs);
    }
    return pairs;
  }

          tryPair(a      , b      , out                ) {
    if (a.invMass === 0 && b.invMass === 0) return;
    if (a.sleeping && b.sleeping) return;
    if (a.invMass === 0 && b.sleeping) return;
    if (b.invMass === 0 && a.sleeping) return;
    if (!((a.layer & b.mask) && (b.layer & a.mask))) return;
    const box = this.box, p = a.slot * 6, q = b.slot * 6;
    if (box[p] > box[q + 3] || box[q] > box[p + 3] || box[p + 1] > box[q + 4] || box[q + 1] > box[p + 4] || box[p + 2] > box[q + 5] || box[q + 2] > box[p + 5]) return;
    out.push([a, b]);
  }

  step(dt        )            {
    stamp++;
    const g = this.gravity;
    const keep = Math.exp(-this.angularDamping * dt), rollKeep = Math.exp(-this.rollingResistance * dt);
    for (const b of this.bodies) {
      if (b.invMass === 0 || b.sleeping) continue;
      b.vel[0] += g[0] * b.gravityScale * dt;
      b.vel[1] += g[1] * b.gravityScale * dt;
      b.vel[2] += g[2] * b.gravityScale * dt;
      b.grounded = false;
    }
    const touching = new Set      ();

    const pairs = this.broadphase();
    this.stats.pairs = pairs.length;
    const contacts            = [];
    this.triggerEvents = [];
    for (const [a, b] of pairs) {
      const c = collide(a, b);
      if (!c) continue;
      if (a.trigger || b.trigger) { this.triggerEvents.push(c); continue; }
      contacts.push(c);
    }
    this.stats.contacts = contacts.length;
    for (const c of contacts) { touching.add(c.a); touching.add(c.b); }

    // bottom-up order lets support propagate through a stack in one sweep
    const low = (c         ) => Math.min(c.a.invMass ? c.a.pos[1] : -Infinity, c.b.invMass ? c.b.pos[1] : -Infinity);
    contacts.sort((x, y) => low(x) - low(y));
    const solved = contacts.map((c) => this.prepare(c, dt));
    for (const s of solved) this.warmStart(s);
    for (let it = 0; it < this.velocityIterations; it++) for (const s of solved) this.solve(s, false, (it & 1) === 1);
    // remember impulses for next step's warm start
    const next = new Map                                                             ();
    for (const s of solved) {
      const { a, b } = s.c, owner = a.id < b.id ? a : b;
      next.set(pairKey(a, b), s.c.points.map((p, i) => ({ local: qrotInv(owner.rot, sub(p, owner.pos)), jn: s.jn[i], jt: [s.jt[i * 2], s.jt[i * 2 + 1]]                     })));
    }
    this.cache = next;
    // shock propagation (Guendelman et al. 2003): a last sweep with the lower body immovable
    for (const s of solved) this.solve(s, true);

    // integrate positions and orientations
    for (const b of this.bodies) {
      if (b.invMass === 0 || b.sleeping) continue;
      b.pos[0] += b.vel[0] * dt; b.pos[1] += b.vel[1] * dt; b.pos[2] += b.vel[2] * dt;
      const w = b.angVel;
      if (w[0] || w[1] || w[2]) {
        const k = touching.has(b) ? keep * rollKeep : keep;
        w[0] *= k; w[1] *= k; w[2] *= k;
        const q = b.rot, hx = w[0] * dt * 0.5, hy = w[1] * dt * 0.5, hz = w[2] * dt * 0.5;
        const x = q[0] + hx * q[3] + hy * q[2] - hz * q[1];
        const y = q[1] + hy * q[3] + hz * q[0] - hx * q[2];
        const z = q[2] + hz * q[3] + hx * q[1] - hy * q[0];
        const ww = q[3] - hx * q[0] - hy * q[1] - hz * q[2];
        const l = Math.hypot(x, y, z, ww);
        b.rot = [x / l, y / l, z / l, ww / l];
      }
    }

    // push apart what still overlaps (linear only). Instead of re-running the
    // narrowphase each pass, track how far each pair has already been separated.
    stamp++;
    const start = new Map            ();
    for (const c of contacts) for (const b of [c.a, c.b]) if (!start.has(b)) start.set(b, [b.pos[0], b.pos[1], b.pos[2]]);
    const depth0 = contacts.map((c) => {
      // depth after this step's motion along the normal
      const da = c.a.vel, db = c.b.vel, n = c.normal;
      return c.depth - ((db[0] - da[0]) * n[0] + (db[1] - da[1]) * n[1] + (db[2] - da[2]) * n[2]) * dt;
    });
    for (let it = 0; it < this.iterations; it++)
      contacts.forEach((c, i) => {
        const sa = start.get(c.a) , sb = start.get(c.b) , n = c.normal;
        const moved = (c.b.pos[0] - sb[0] - (c.a.pos[0] - sa[0])) * n[0] + (c.b.pos[1] - sb[1] - (c.a.pos[1] - sa[1])) * n[1] + (c.b.pos[2] - sb[2] - (c.a.pos[2] - sa[2])) * n[2];
        const d = depth0[i] - moved;
        if (d > 0.003) this.correct({ ...c, depth: d });
      });

    let sleeping = 0;
    for (const b of this.bodies) {
      if (b.invMass === 0) continue;
      // smoothed motion so one jittery frame doesn't reset the sleep timer
      const sp = Math.hypot(b.vel[0], b.vel[1], b.vel[2]), spin = Math.hypot(b.angVel[0], b.angVel[1], b.angVel[2]);
      b.motion = b.motion * 0.85 + 0.15 * Math.max(sp / SLEEP_SPEED, spin / SLEEP_SPIN);
      if (b.grounded && b.motion < 1) {
        b.sleepTimer += dt;
        if (b.sleepTimer > SLEEP_TIME) { b.sleeping = true; b.vel = [0, 0, 0]; b.angVel = [0, 0, 0]; }
      } else b.sleepTimer = 0;
      if (b.sleeping) sleeping++;
    }
    this.stats.sleeping = sleeping;
    return contacts;
  }

          prepare(c         , dt        )         {
    const { a, b, normal: n } = c;
    if (n[1] < -0.6) a.grounded = true; // n points a->b: b below a
    if (n[1] > 0.6) b.grounded = true;
    // only a real impact wakes a sleeper; something merely resting on it doesn't
    const impact = Math.hypot(b.vel[0] - a.vel[0], b.vel[1] - a.vel[1], b.vel[2] - a.vel[2]) > 1;
    if (a.sleeping && b.invMass > 0 && impact) this.wake(a);
    if (b.sleeping && a.invMass > 0 && impact) this.wake(b);
    // two tangents perpendicular to the normal
    const ref       = Math.abs(n[0]) < 0.57 ? [1, 0, 0] : [0, 1, 0];
    const t1 = cross(n, ref), l1 = Math.hypot(t1[0], t1[1], t1[2]);
    t1[0] /= l1; t1[1] /= l1; t1[2] /= l1;
    const t2 = cross(n, t1);
    const s         = { c, ra: [], rb: [], kn: [], jn: [], jt: [], kt: [], t: [t1, t2], bias: [], ia: a.sleeping ? 0 : a.invMass, ib: b.sleeping ? 0 : b.invMass };
    const e = Math.min(a.restitution, b.restitution);
    for (const p of c.points) {
      const ra = sub(p, a.pos), rb = sub(p, b.pos);
      const rna = cross(ra, n), rnb = cross(rb, n);
      const k = s.ia + s.ib + (s.ia ? dot(rna, applyInvInertia(a, rna)) : 0) + (s.ib ? dot(rnb, applyInvInertia(b, rnb)) : 0);
      s.ra.push(ra); s.rb.push(rb); s.kn.push(k > 0 ? 1 / k : 0); s.jn.push(0);
      for (const t of [t1, t2]) {
        const rta = cross(ra, t), rtb = cross(rb, t);
        const kt = s.ia + s.ib + (s.ia ? dot(rta, applyInvInertia(a, rta)) : 0) + (s.ib ? dot(rtb, applyInvInertia(b, rtb)) : 0);
        s.kt.push(kt > 0 ? 1 / kt : 0); s.jt.push(0);
      }
      const vn = dot(this.relVel(a, b, ra, rb), n);
      // bounce only off real impacts so resting contact stays quiet
      s.bias.push(vn < -2 ? -e * vn : 0);
    }
    void dt;
    return s;
  }

  /** Seed each point's accumulated impulse from the matching point last step and apply it. */
          warmStart(s        ) {
    const { a, b, normal: n } = s.c;
    const prev = this.cache.get(pairKey(a, b));
    if (!prev) return;
    const owner = a.id < b.id ? a : b;
    s.c.points.forEach((p, i) => {
      const local = qrotInv(owner.rot, sub(p, owner.pos));
      let best = 0.06 * 0.06, m                               = null;
      for (const q of prev) {
        const dx = q.local[0] - local[0], dy = q.local[1] - local[1], dz = q.local[2] - local[2], d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < best) { best = d2; m = q; }
      }
      if (!m) return;
      const k = 0.9;
      s.jn[i] = m.jn * k; s.jt[i * 2] = m.jt[0] * k; s.jt[i * 2 + 1] = m.jt[1] * k;
      const [t1, t2] = s.t;
      const J       = [n[0] * s.jn[i] + t1[0] * s.jt[i * 2] + t2[0] * s.jt[i * 2 + 1], n[1] * s.jn[i] + t1[1] * s.jt[i * 2] + t2[1] * s.jt[i * 2 + 1], n[2] * s.jn[i] + t1[2] * s.jt[i * 2] + t2[2] * s.jt[i * 2 + 1]];
      this.impulse(a, s.ia, s.ra[i], J, -1);
      this.impulse(b, s.ib, s.rb[i], J, 1);
    });
  }

          relVel(a      , b      , ra      , rb      )       {
    const wa = cross(a.angVel, ra), wb = cross(b.angVel, rb);
    return [b.vel[0] + wb[0] - a.vel[0] - wa[0], b.vel[1] + wb[1] - a.vel[1] - wa[1], b.vel[2] + wb[2] - a.vel[2] - wa[2]];
  }

          impulse(body      , invM        , r      , j      , sign        ) {
    if (invM === 0) return;
    body.vel[0] += sign * j[0] * invM; body.vel[1] += sign * j[1] * invM; body.vel[2] += sign * j[2] * invM;
    const dw = applyInvInertia(body, cross(r, j));
    body.angVel[0] += sign * dw[0]; body.angVel[1] += sign * dw[1]; body.angVel[2] += sign * dw[2];
  }

  /**
   * Shock propagation step: lower body immovable, linear impulse through the
   * upper body's centre only, so it removes sinking without adding any spin.
   */
          shock(s        ) {
    const { a, b, normal: n } = s.c;
    if (Math.abs(n[1]) <= 0.6) return;
    const upper = n[1] < 0 ? a : b, lower = upper === a ? b : a;
    if (upper.invMass === 0) return;
    // normal pointing from lower to upper
    const un       = upper === b ? n : [-n[0], -n[1], -n[2]];
    const vn = (upper.vel[0] - lower.vel[0]) * un[0] + (upper.vel[1] - lower.vel[1]) * un[1] + (upper.vel[2] - lower.vel[2]) * un[2];
    if (vn >= 0) return;
    upper.vel[0] -= vn * un[0]; upper.vel[1] -= vn * un[1]; upper.vel[2] -= vn * un[2];
  }

  /** reverse: walk the points backwards on odd passes so no corner is always first. */
          solve(s        , shock         , reverse = false) {
    if (shock) { this.shock(s); return; }
    const { a, b, normal: n } = s.c;
    const ia = s.ia, ib = s.ib;
    if (ia + ib === 0) return;
    const np = s.ra.length;
    // normal impulses first, accumulated per point and clamped to push only
    for (let q = 0; q < np; q++) {
      const i = reverse ? np - 1 - q : q;
      const ra = s.ra[i], rb = s.rb[i];
      const vn = dot(this.relVel(a, b, ra, rb), n);
      const old = s.jn[i];
      s.jn[i] = Math.max(0, old + (s.bias[i] - vn) * s.kn[i]);
      const dj = s.jn[i] - old;
      if (dj === 0) continue;
      const J       = [n[0] * dj, n[1] * dj, n[2] * dj];
      this.impulse(a, ia, ra, J, -1);
      this.impulse(b, ib, rb, J, 1);
    }
    // friction on two fixed tangent axes, each clamped to the Coulomb limit
    const mu = Math.sqrt(a.friction * b.friction);
    if (mu === 0) return;
    for (let q = 0; q < np; q++) {
      const i = reverse ? np - 1 - q : q;
      const ra = s.ra[i], rb = s.rb[i], limit = mu * s.jn[i];
      for (let k = 0; k < 2; k++) {
        const t = s.t[k];
        const vt = dot(this.relVel(a, b, ra, rb), t);
        const old = s.jt[i * 2 + k];
        s.jt[i * 2 + k] = Math.max(-limit, Math.min(limit, old - vt * s.kt[i * 2 + k]));
        const dj = s.jt[i * 2 + k] - old;
        if (dj === 0) continue;
        const J       = [t[0] * dj, t[1] * dj, t[2] * dj];
        this.impulse(a, ia, ra, J, -1);
        this.impulse(b, ib, rb, J, 1);
      }
    }
  }

          correct(c         ) {
    const { a, b, normal: n } = c;
    // sleepers hold still: they rest on things the solver no longer checks them against
    const ma = a.sleeping ? 0 : a.invMass, mb = b.sleeping ? 0 : b.invMass;
    const wsum = ma + mb;
    if (wsum === 0) return;
    const k = Math.max(c.depth - 0.003, 0) * 0.8 / wsum;
    a.pos[0] -= n[0] * k * ma; a.pos[1] -= n[1] * k * ma; a.pos[2] -= n[2] * k * ma;
    b.pos[0] += n[0] * k * mb; b.pos[1] += n[1] * k * mb; b.pos[2] += n[2] * k * mb;
  }

  /** Nearest hit along origin + t*dir for t in [0, maxT]. dir need not be normalized. */
  raycast(origin      , dir      , maxT = Infinity, mask = 0xffff, ignore       )                {
    let best                = null;
    for (const b of this.bodies) {
      if (b === ignore || b.trigger || !(b.layer & mask)) continue;
      const h = rayBody(origin, dir, b);
      if (h && h.t <= maxT && (!best || h.t < best.t)) best = h;
    }
    return best;
  }
}

export function rayBody(o      , d      , b      )                {
  if (b.shape.kind === "sphere") {
    const r = b.shape.r;
    const m = sub(o, b.pos);
    const A = dot(d, d), B = dot(m, d), C = dot(m, m) - r * r;
    const disc = B * B - A * C;
    if (disc < 0 || A === 0) return null;
    let t = (-B - Math.sqrt(disc)) / A;
    if (t < 0) { if (C <= 0) t = 0; else return null; }
    const p       = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    return { body: b, t, point: p, normal: [(p[0] - b.pos[0]) / r, (p[1] - b.pos[1]) / r, (p[2] - b.pos[2]) / r] };
  }
  // slab test in the box's local frame
  const rot = b.rot ?? [0, 0, 0, 1];
  const lo = qrotInv(rot, sub(o, b.pos)), ld = qrotInv(rot, d), h = b.shape.half;
  let tmin = -Infinity, tmax = Infinity, axis = 0, sign = -1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ld[i]) < 1e-12) { if (lo[i] < -h[i] || lo[i] > h[i]) return null; continue; }
    let t1 = (-h[i] - lo[i]) / ld[i], t2 = (h[i] - lo[i]) / ld[i], s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  const t = Math.max(tmin, 0);
  const nl       = [0, 0, 0];
  nl[axis] = sign;
  return { body: b, t, point: [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t], normal: qrot(rot, nl) };
}
