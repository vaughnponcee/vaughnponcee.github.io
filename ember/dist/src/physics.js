/**
 * Rigid body physics for spheres and axis-aligned boxes.
 *
 * Fixed step, semi-implicit Euler, uniform-grid broadphase, impulse contacts
 * with restitution and Coulomb friction, iterative position correction, and
 * sleeping. Bodies do not rotate: this is the classic arcade model that keeps
 * characters, crates and projectiles stable without a full solver.
 */
                                      

                                                                                

                       
             
            
            
               
                                    
                  
                      
                   
                                                 
                   
                       
                                                                                
                
               
                    
                    
                     
                 
 

                                                                          
                                                                            

                              
            
               
                
             
                       
                    
                    
                        
                 
                
                 
 

const SLEEP_SPEED = 0.05;
const SLEEP_TIME = 0.6;

function aabbOf(b      )                                                   {
  const p = b.pos;
  if (b.shape.kind === "sphere") {
    const r = b.shape.r;
    return [p[0] - r, p[1] - r, p[2] - r, p[0] + r, p[1] + r, p[2] + r];
  }
  const h = b.shape.half;
  return [p[0] - h[0], p[1] - h[1], p[2] - h[2], p[0] + h[0], p[1] + h[1], p[2] + h[2]];
}

/** Narrowphase. Normal points from a to b. */
export function collide(a      , b      )                 {
  const sa = a.shape, sb = b.shape;
  if (sa.kind === "sphere" && sb.kind === "sphere") {
    const d       = [b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]];
    const dist = Math.hypot(d[0], d[1], d[2]);
    const rs = sa.r + sb.r;
    if (dist >= rs) return null;
    const n       = dist > 1e-9 ? [d[0] / dist, d[1] / dist, d[2] / dist] : [0, 1, 0];
    return { a, b, normal: n, depth: rs - dist };
  }
  if (sa.kind === "box" && sb.kind === "box") {
    let best = Infinity, axis = 0, sign = 1;
    for (let i = 0; i < 3; i++) {
      const d = b.pos[i] - a.pos[i];
      const o = sa.half[i] + sb.half[i] - Math.abs(d);
      if (o <= 0) return null;
      if (o < best) { best = o; axis = i; sign = d < 0 ? -1 : 1; }
    }
    const n       = [0, 0, 0];
    n[axis] = sign;
    return { a, b, normal: n, depth: best };
  }
  // sphere vs box: flip so the sphere is s and the box is x
  const flip = sa.kind === "box";
  const s = flip ? b : a, x = flip ? a : b;
  const r = (s.shape                 ).r, h = (x.shape                  ).half;
  const rel       = [s.pos[0] - x.pos[0], s.pos[1] - x.pos[1], s.pos[2] - x.pos[2]];
  const cl       = [
    Math.max(-h[0], Math.min(h[0], rel[0])),
    Math.max(-h[1], Math.min(h[1], rel[1])),
    Math.max(-h[2], Math.min(h[2], rel[2])),
  ];
  const inside = cl[0] === rel[0] && cl[1] === rel[1] && cl[2] === rel[2];
  let n      , depth        ;
  if (inside) {
    // centre inside the box: push out along the axis of least penetration
    let best = Infinity, axis = 0;
    for (let i = 0; i < 3; i++) {
      const o = h[i] - Math.abs(rel[i]);
      if (o < best) { best = o; axis = i; }
    }
    n = [0, 0, 0];
    n[axis] = rel[axis] < 0 ? -1 : 1;
    depth = best + r;
  } else {
    const d       = [rel[0] - cl[0], rel[1] - cl[1], rel[2] - cl[2]];
    const dist = Math.hypot(d[0], d[1], d[2]);
    if (dist >= r) return null;
    n = [d[0] / dist, d[1] / dist, d[2] / dist];
    depth = r - dist;
  }
  // n points from box to sphere; contact normal must point from a to b
  const out       = flip ? n : [-n[0], -n[1], -n[2]];
  return { a, b, normal: out, depth };
}

export class PhysicsWorld {
  bodies         = [];
  gravity       = [0, -24, 0];
  /** Velocity and position solver passes. */
  velocityIterations = 6;
  iterations = 8;
  cell = 4;
  /** Overlaps involving triggers from the last step. */
  triggerEvents            = [];
  stats = { pairs: 0, contacts: 0, sleeping: 0 };
          nextId = 1;

  add(o             )       {
    const b       = {
      id: this.nextId++,
      pos: [...o.pos]        ,
      vel: o.vel ? ([...o.vel]        ) : [0, 0, 0],
      shape: o.shape,
      invMass: o.mass && o.mass > 0 ? 1 / o.mass : 0,
      restitution: o.restitution ?? 0.1,
      friction: o.friction ?? 0.5,
      trigger: o.trigger ?? false,
      gravityScale: o.gravityScale ?? 1,
      layer: o.layer ?? 1,
      mask: o.mask ?? 0xffff,
      grounded: false,
      sleeping: false,
      sleepTimer: 0,
      user: o.user,
    };
    this.bodies.push(b);
    return b;
  }

  remove(b      )       {
    const i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
  }

  wake(b      )       { b.sleeping = false; b.sleepTimer = 0; }

  /** Candidate pairs from a uniform grid. Each pair appears once. */
  broadphase()                 {
    const grid = new Map                ();
    const inv = 1 / this.cell;
    const pairs                 = [];
    const seen = new Set        ();
    for (const b of this.bodies) {
      const [x0, y0, z0, x1, y1, z1] = aabbOf(b);
      const ax = Math.floor(x0 * inv), ay = Math.floor(y0 * inv), az = Math.floor(z0 * inv);
      const bx = Math.floor(x1 * inv), by = Math.floor(y1 * inv), bz = Math.floor(z1 * inv);
      // huge statics (floors) would fill thousands of cells; test them against everyone instead
      if ((bx - ax + 1) * (by - ay + 1) * (bz - az + 1) > 64) {
        for (const o of this.bodies) if (o !== b) this.pushPair(b, o, pairs, seen);
        continue;
      }
      for (let x = ax; x <= bx; x++)
        for (let y = ay; y <= by; y++)
          for (let z = az; z <= bz; z++) {
            const k = x + "," + y + "," + z;
            let list = grid.get(k);
            if (!list) { list = []; grid.set(k, list); }
            for (const o of list) this.pushPair(b, o, pairs, seen);
            list.push(b);
          }
    }
    return pairs;
  }

          pushPair(a      , b      , out                , seen             ) {
    if (a.invMass === 0 && b.invMass === 0) return;
    if (a.sleeping && b.sleeping) return;
    if (a.invMass === 0 && b.sleeping) return;
    if (b.invMass === 0 && a.sleeping) return;
    if (!((a.layer & b.mask) && (b.layer & a.mask))) return;
    const lo = Math.min(a.id, b.id), hi = Math.max(a.id, b.id);
    const key = lo * 1048576 + hi;
    if (seen.has(key)) return;
    seen.add(key);
    out.push([a, b]);
  }

  step(dt        )            {
    const g = this.gravity;
    for (const b of this.bodies) {
      if (b.invMass === 0 || b.sleeping) continue;
      b.vel[0] += g[0] * b.gravityScale * dt;
      b.vel[1] += g[1] * b.gravityScale * dt;
      b.vel[2] += g[2] * b.gravityScale * dt;
      b.pos[0] += b.vel[0] * dt;
      b.pos[1] += b.vel[1] * dt;
      b.pos[2] += b.vel[2] * dt;
      b.grounded = false;
    }

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

    // bottom-up order lets support propagate through a stack in one sweep
    const low = (c         ) => Math.min(c.a.invMass ? c.a.pos[1] : -Infinity, c.b.invMass ? c.b.pos[1] : -Infinity);
    contacts.sort((x, y) => low(x) - low(y));
    for (let it = 0; it < this.velocityIterations; it++)
      for (const c of contacts) this.resolveVelocity(c, it === 0);
    // shock propagation (Guendelman et al. 2003): one more bottom-up sweep
    // treating the lower body as immovable, so resting stacks settle exactly
    for (const c of contacts) this.resolveVelocity(c, false, true);
    for (let it = 0; it < this.iterations; it++) {
      for (const c of contacts) {
        const fresh = collide(c.a, c.b);
        if (fresh) this.correct(fresh);
      }
    }

    let sleeping = 0;
    for (const b of this.bodies) {
      if (b.invMass === 0) continue;
      const sp = Math.hypot(b.vel[0], b.vel[1], b.vel[2]);
      if (b.grounded && sp < SLEEP_SPEED) {
        b.sleepTimer += dt;
        if (b.sleepTimer > SLEEP_TIME) { b.sleeping = true; b.vel = [0, 0, 0]; }
      } else b.sleepTimer = 0;
      if (b.sleeping) sleeping++;
    }
    this.stats.sleeping = sleeping;
    return contacts;
  }

          resolveVelocity(c         , first         , shock = false) {
    const { a, b, normal: n } = c;
    let ia = a.invMass, ib = b.invMass;
    if (shock && Math.abs(n[1]) > 0.6) {
      // n points a->b; n.y < 0 means b is below a
      if (n[1] < 0) ib = 0; else ia = 0;
    }
    const wsum = ia + ib;
    if (wsum === 0) return;
    if (n[1] < -0.6) a.grounded = true; // b is below a? normal points a->b, so b below means n.y < 0
    if (n[1] > 0.6) b.grounded = true;
    // a body resting on something else wakes when hit
    if (a.sleeping && b.invMass > 0) this.wake(a);
    if (b.sleeping && a.invMass > 0) this.wake(b);
    const rv       = [b.vel[0] - a.vel[0], b.vel[1] - a.vel[1], b.vel[2] - a.vel[2]];
    const vn = rv[0] * n[0] + rv[1] * n[1] + rv[2] * n[2];
    if (vn > 0) return; // separating
    const e = Math.min(a.restitution, b.restitution);
    // no bounce for slow contacts so resting stacks settle
    const bounce = first && -vn > 2 ? e : 0;
    const j = (-(1 + bounce) * vn) / wsum;
    a.vel[0] -= j * n[0] * ia; a.vel[1] -= j * n[1] * ia; a.vel[2] -= j * n[2] * ia;
    b.vel[0] += j * n[0] * ib; b.vel[1] += j * n[1] * ib; b.vel[2] += j * n[2] * ib;

    // friction along the tangent of the remaining relative velocity
    const rv2       = [b.vel[0] - a.vel[0], b.vel[1] - a.vel[1], b.vel[2] - a.vel[2]];
    const vn2 = rv2[0] * n[0] + rv2[1] * n[1] + rv2[2] * n[2];
    const t       = [rv2[0] - vn2 * n[0], rv2[1] - vn2 * n[1], rv2[2] - vn2 * n[2]];
    const tl = Math.hypot(t[0], t[1], t[2]);
    if (tl < 1e-9) return;
    t[0] /= tl; t[1] /= tl; t[2] /= tl;
    const mu = Math.sqrt(a.friction * b.friction);
    let jt = -tl / wsum;
    if (Math.abs(jt) > j * mu) jt = -j * mu; // Coulomb cone
    a.vel[0] -= jt * t[0] * ia; a.vel[1] -= jt * t[1] * ia; a.vel[2] -= jt * t[2] * ia;
    b.vel[0] += jt * t[0] * ib; b.vel[1] += jt * t[1] * ib; b.vel[2] += jt * t[2] * ib;
  }

          correct(c         ) {
    const { a, b, normal: n } = c;
    const wsum = a.invMass + b.invMass;
    if (wsum === 0) return;
    const slop = 0.002;
    const k = Math.max(c.depth - slop, 0) / wsum;
    a.pos[0] -= n[0] * k * a.invMass; a.pos[1] -= n[1] * k * a.invMass; a.pos[2] -= n[2] * k * a.invMass;
    b.pos[0] += n[0] * k * b.invMass; b.pos[1] += n[1] * k * b.invMass; b.pos[2] += n[2] * k * b.invMass;
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
    const m       = [o[0] - b.pos[0], o[1] - b.pos[1], o[2] - b.pos[2]];
    const A = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const B = m[0] * d[0] + m[1] * d[1] + m[2] * d[2];
    const C = m[0] * m[0] + m[1] * m[1] + m[2] * m[2] - r * r;
    const disc = B * B - A * C;
    if (disc < 0 || A === 0) return null;
    let t = (-B - Math.sqrt(disc)) / A;
    if (t < 0) { if (C <= 0) t = 0; else return null; } // origin inside
    const p       = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    const n       = [(p[0] - b.pos[0]) / r, (p[1] - b.pos[1]) / r, (p[2] - b.pos[2]) / r];
    return { body: b, t, point: p, normal: n };
  }
  // slab test
  const h = b.shape.half;
  let tmin = -Infinity, tmax = Infinity, axis = 0, sign = -1;
  for (let i = 0; i < 3; i++) {
    const lo = b.pos[i] - h[i], hi = b.pos[i] + h[i];
    if (Math.abs(d[i]) < 1e-12) {
      if (o[i] < lo || o[i] > hi) return null;
      continue;
    }
    let t1 = (lo - o[i]) / d[i], t2 = (hi - o[i]) / d[i];
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  const t = Math.max(tmin, 0);
  const p       = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  const n       = [0, 0, 0];
  n[axis] = sign;
  return { body: b, t, point: p, normal: n };
}
