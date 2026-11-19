/**
 * Demo: "Crystal Run". Collect every crystal on a floating arena.
 * Shows the engine end to end: ECS-driven systems, rigid body physics,
 * instanced shadowed rendering, point lights, particles, input and audio.
 */
import { World,             } from "../src/ecs.js";
import { PhysicsWorld,           } from "../src/physics.js";
import { Renderer,                        } from "../src/renderer.js";
import { box, cylinder, gem, sphere } from "../src/mesh.js";
import { FixedLoop } from "../src/loop.js";
import { Input } from "../src/input.js";
import { Sfx } from "../src/audio.js";
import { Particles } from "../src/particles.js";
import {            clamp, damp, fromTRS, lerp, quatFromEuler, rng } from "../src/math.js";

const canvas = document.getElementById("view")                     ;
const hud = document.getElementById("hud") ;
const banner = document.getElementById("banner") ;
const params = new URLSearchParams(location.search);
const BENCH = params.has("bench");

const R = new Renderer(canvas);
const meshes = { box: R.createMesh(box()), ball: R.createMesh(sphere(24, 16)), cyl: R.createMesh(cylinder(20)), gem: R.createMesh(gem()) };
const world = new World();
const phys = new PhysicsWorld();
const input = new Input(canvas);
const sfx = new Sfx();
const parts = new Particles(3000);
const loop = new FixedLoop(1 / 60);
const rand = rng(Number(params.get("seed") ?? 7));

// components
                                                                                                                            
                                              
                                                                       
const C = {
  body: world.store      ("body"),
  render: world.store        ("render"),
  gem: world.store     ("gem"),
  pad: world.store        ("pad"),
  mover: world.store       ("mover"),
  prev: world.store      ("prev"),
};

const LAYER_WORLD = 1, LAYER_PLAYER = 2, LAYER_PROP = 4;

function solid(pos      , half      , color      , o                  = {})         {
  const e = world.spawn();
  C.body.set(e, phys.add({ pos, shape: { kind: "box", half }, friction: 0.9, layer: LAYER_WORLD, user: e }));
  C.render.set(e, { mesh: meshes.box, color, size: [half[0] * 2, half[1] * 2, half[2] * 2], rough: 0.85, ...o });
  return e;
}

function crate(pos      , s        )         {
  const e = world.spawn();
  C.body.set(e, phys.add({ pos, shape: { kind: "box", half: [s / 2, s / 2, s / 2] }, mass: s * s * s * 2, friction: 0.7, restitution: 0.2, layer: LAYER_PROP, user: e }));
  C.render.set(e, { mesh: meshes.box, color: [0.62, 0.42, 0.24], size: [s, s, s], rough: 0.8 });
  C.prev.set(e, [...pos]        );
  return e;
}

function ball(pos      , r        , color      )         {
  const e = world.spawn();
  C.body.set(e, phys.add({ pos, shape: { kind: "sphere", r }, mass: r * r * r * 6, friction: 0.4, restitution: 0.55, layer: LAYER_PROP, user: e }));
  C.render.set(e, { mesh: meshes.ball, color, size: [r * 2, r * 2, r * 2], rough: 0.15 });
  C.prev.set(e, [...pos]        );
  return e;
}

// ---- level -------------------------------------------------------------
const STONE       = [0.55, 0.56, 0.58], MOSS       = [0.36, 0.5, 0.32], DARK       = [0.3, 0.31, 0.34];
solid([0, -1, 0], [22, 1, 22], MOSS, { checker: true, rough: 0.95 });
// rim walls
for (const [x, z, hx, hz] of [[0, -22.5, 22, 0.5], [0, 22.5, 22, 0.5], [-22.5, 0, 0.5, 22], [22.5, 0, 0.5, 22]])
  solid([x, 0.6, z], [hx, 0.6, hz], DARK);
// central tower: stepped platforms
const steps                 = [
  [[0, 0.5, 0], [4, 0.5, 4]],
  [[0, 1.5, 0], [2.6, 0.5, 2.6]],
  [[0, 2.5, 0], [1.4, 0.5, 1.4]],
];
for (const [p, h] of steps) solid(p, h, STONE);
// floating islands
const islands         = [[-13, 3, -11], [12, 4.5, -13], [14, 3.5, 10], [-12, 5.5, 12], [0, 8, -16]];
islands.forEach((p) => solid(p, [2.2, 0.4, 2.2], STONE));
// pillars with lamps
const lamps         = [];
for (const [x, z] of [[-8, -8], [8, -8], [8, 8], [-8, 8]]) {
  const e = world.spawn();
  C.body.set(e, phys.add({ pos: [x, 1.5, z], shape: { kind: "box", half: [0.45, 1.5, 0.45] }, layer: LAYER_WORLD }));
  C.render.set(e, { mesh: meshes.cyl, color: DARK, size: [0.9, 3, 0.9], rough: 0.7 });
  const l = world.spawn();
  C.render.set(l, { mesh: meshes.ball, color: [1, 0.72, 0.38], size: [0.55, 0.55, 0.55], emissive: 3 });
  C.prev.set(l, [x, 3.3, z]);
  lamps.push([x, 3.3, z]);
  R.lights.push({ pos: [x, 3.3, z], color: [3.2, 2.0, 1.0], radius: 9 });
}
// jump pads (triggers)
const padSpots                   = [];
for (const p of [[-13, 0.1, -4], [12, 0.1, -5], [10, 0.1, 15], [-6, 0.1, 12], [0, 0.1, -9]]          ) {
  const e = world.spawn();
  C.body.set(e, phys.add({ pos: [p[0], 0.4, p[2]], shape: { kind: "box", half: [0.9, 0.4, 0.9] }, trigger: true, user: e }));
  C.render.set(e, { mesh: meshes.cyl, color: [0.25, 0.85, 0.55], size: [1.8, 0.2, 1.8], emissive: 1.4 });
  C.pad.set(e, 1);
  padSpots.push([p, e]);
}
// moving platform between the tower and the high island
{
  const e = world.spawn();
  const from       = [0, 4.5, -6], to       = [0, 7.6, -12.5];
  C.body.set(e, phys.add({ pos: from, shape: { kind: "box", half: [1.6, 0.3, 1.6] }, friction: 1, layer: LAYER_WORLD }));
  C.render.set(e, { mesh: meshes.box, color: [0.75, 0.62, 0.42], size: [3.2, 0.6, 3.2], rough: 0.5 });
  C.mover.set(e, { from, to, period: 6, phase: 0 });
}
// props
for (let i = 0; i < 26; i++) {
  const a = rand() * Math.PI * 2, d = 6 + rand() * 13;
  crate([Math.cos(a) * d, 0.5 + rand() * 4, Math.sin(a) * d], 0.6 + rand() * 0.7);
}
// ?stress=N drops N extra crates in to measure scaling
for (let i = 0; i < Number(params.get("stress") ?? 0); i++) crate([rand() * 36 - 18, 2 + rand() * 40, rand() * 36 - 18], 0.5 + rand() * 0.4);
for (let i = 0; i < 6; i++) ball([rand() * 30 - 15, 3 + rand() * 3, rand() * 30 - 15], 0.35 + rand() * 0.35, [[0.85, 0.3, 0.25], [0.25, 0.45, 0.85], [0.9, 0.8, 0.3]][i % 3]        );
// crystals: on the ground, the tower top and every island
const gemSpots         = [[0, 3.8, 0], ...islands.map((p) => [p[0], p[1] + 1.3, p[2]]        )];
for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.4; gemSpots.push([Math.cos(a) * 16, 1.1, Math.sin(a) * 16]); }
const GEM_COLOR       = [0.4, 0.9, 1.0];
for (const p of gemSpots) {
  const e = world.spawn();
  C.body.set(e, phys.add({ pos: p, shape: { kind: "sphere", r: 0.7 }, trigger: true, user: e }));
  C.render.set(e, { mesh: meshes.gem, color: GEM_COLOR, size: [0.9, 1.3, 0.9], emissive: 2.2 });
  R.lights.push({ pos: p, color: [0.6, 1.6, 2.0], radius: 4.5 });
  C.gem.set(e, { phase: rand() * 6.28, light: R.lights.length - 1 });
}
const totalGems = gemSpots.length;

// ---- player ------------------------------------------------------------
const SPAWN       = [0, 2, 9];
const player = world.spawn();
const pBody = phys.add({ pos: SPAWN, shape: { kind: "sphere", r: 0.45 }, mass: 2, friction: 0, restitution: 0, layer: LAYER_PLAYER, user: player });
C.body.set(player, pBody);
C.prev.set(player, [...SPAWN]        );
let yaw = Math.PI, pitch = 0.32, facing = Math.PI, coyote = 0, jumpBuffer = 0, airborneVy = 0;
let collected = 0, startTime = 0, finished = 0, started = false;

// ---- systems -----------------------------------------------------------
function playerSystem(dt        ) {
  const ax = input.axes();
  const run = input.held("ShiftLeft") || input.padButton(1);
  const speed = run ? 9.5 : 6.2;
  // camera-relative movement
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx;
  let mx = fx * ax.y + rx * ax.x, mz = fz * ax.y + rz * ax.x;
  const ml = Math.hypot(mx, mz);
  if (ml > 1) { mx /= ml; mz /= ml; }
  const accel = pBody.grounded ? 14 : 4;
  pBody.vel[0] = lerp(pBody.vel[0], mx * speed, damp(accel, dt));
  pBody.vel[2] = lerp(pBody.vel[2], mz * speed, damp(accel, dt));
  if (ml > 0.1) facing = Math.atan2(-mx, -mz);
  pBody.sleeping = false;

  coyote = pBody.grounded ? 0.12 : Math.max(0, coyote - dt);
  if (input.pressed("Space") || input.padButton(0)) jumpBuffer = 0.12;
  else jumpBuffer = Math.max(0, jumpBuffer - dt);
  if (jumpBuffer > 0 && coyote > 0) {
    pBody.vel[1] = 10.5;
    coyote = jumpBuffer = 0;
    sfx.jump();
    parts.burst([pBody.pos[0], pBody.pos[1] - 0.4, pBody.pos[2]], [0.8, 0.8, 0.75], 10, 2.5, 0.4, 0.08);
  }
  // shorter hop when the jump key is released early
  if (pBody.vel[1] > 0 && !input.held("Space") && !input.padButton(0)) pBody.vel[1] -= 30 * dt;
  if (!pBody.grounded) airborneVy = Math.min(airborneVy, pBody.vel[1]);

  if (pBody.pos[1] < -12) {
    pBody.pos = [...SPAWN]        ;
    pBody.vel = [0, 0, 0];
    C.prev.set(player, [...SPAWN]        );
    banner.textContent = "Fell off. Back to the start.";
    banner.className = "show";
    setTimeout(() => (banner.className = ""), 1400);
  }
}

function moverSystem(t        , dt        ) {
  for (const e of world.query("mover", "body")) {
    const m = C.mover.get(e) , b = C.body.get(e) ;
    const k = 0.5 - 0.5 * Math.cos(((t + m.phase) / m.period) * Math.PI * 2);
    const next       = [lerp(m.from[0], m.to[0], k), lerp(m.from[1], m.to[1], k), lerp(m.from[2], m.to[2], k)];
    const v       = [(next[0] - b.pos[0]) / dt, (next[1] - b.pos[1]) / dt, (next[2] - b.pos[2]) / dt];
    // carry anything standing on it
    for (const o of phys.bodies) {
      if (o.invMass === 0 || o.trigger) continue;
      const half = (b.shape                  ).half;
      const r = o.shape.kind === "sphere" ? o.shape.r : o.shape.half[1];
      if (Math.abs(o.pos[0] - b.pos[0]) < half[0] + 0.1 && Math.abs(o.pos[2] - b.pos[2]) < half[2] + 0.1 && Math.abs(o.pos[1] - r - (b.pos[1] + half[1])) < 0.12) {
        o.pos[0] += v[0] * dt; o.pos[2] += v[2] * dt;
        if (v[1] > 0) o.pos[1] += v[1] * dt;
        o.sleeping = false;
      }
    }
    b.pos = next;
  }
}

function triggerSystem() {
  for (const c of phys.triggerEvents) {
    const other = c.a.trigger ? c.b : c.a, trig = c.a.trigger ? c.a : c.b;
    const te = trig.user          ;
    if (other === pBody && C.gem.has(te)) {
      const g = C.gem.get(te) ;
      parts.burst(trig.pos, GEM_COLOR, 70, 7, 0.9, 0.1);
      parts.burst(trig.pos, [1, 1, 1], 20, 4, 0.5, 0.06);
      R.lights[g.light].radius = 0;
      phys.remove(trig);
      world.destroyLater(te);
      collected++;
      sfx.pickup(1 + collected * 0.04);
      if (collected === totalGems) { finished = performance.now(); sfx.win(); }
    }
    if (C.pad.has(te) && other.invMass > 0 && other.vel[1] < 4) {
      other.vel[1] = other === pBody ? 17 : 13;
      other.sleeping = false;
      if (other === pBody) { sfx.pad(); parts.burst(trig.pos, [0.3, 1, 0.6], 30, 5, 0.6, 0.08); }
    }
  }
}

let lastGround = true;
function landingFx() {
  if (pBody.grounded && !lastGround && airborneVy < -9) {
    sfx.land(-airborneVy / 4);
    parts.burst([pBody.pos[0], pBody.pos[1] - 0.45, pBody.pos[2]], [0.7, 0.68, 0.62], Math.round(-airborneVy), 3, 0.5, 0.09);
  }
  if (pBody.grounded) airborneVy = 0;
  lastGround = pBody.grounded;
}

function savePrev() {
  for (const e of world.query("prev", "body")) {
    const p = C.prev.get(e) , b = C.body.get(e) ;
    p[0] = b.pos[0]; p[1] = b.pos[1]; p[2] = b.pos[2];
  }
}

// ---- camera ------------------------------------------------------------
const cam         = { pos: [0, 6, 18], target: [0, 1, 0], fov: (62 * Math.PI) / 180, near: 0.1, far: 220 };
let camDist = 9;
function updateCamera(dt        , focus      ) {
  yaw -= input.mouseDX * 0.0025;
  pitch = clamp(pitch + input.mouseDY * 0.002, -0.2, 1.2);
  if (input.held("KeyQ")) yaw += 2.2 * dt;
  if (input.held("KeyE")) yaw -= 2.2 * dt;
  const target       = [focus[0], focus[1] + 1.1, focus[2]];
  const dir       = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
  // pull the camera in when terrain is between it and the player
  const hit = phys.raycast(target, dir, 9, LAYER_WORLD);
  const want = hit ? Math.max(1.5, hit.t - 0.3) : 9;
  camDist = want < camDist ? want : lerp(camDist, want, damp(3, dt));
  const k = damp(14, dt);
  for (let i = 0; i < 3; i++) {
    cam.target[i] = lerp(cam.target[i], target[i], k);
    cam.pos[i] = cam.target[i] + dir[i] * camDist;
  }
}

// ---- frame -------------------------------------------------------------
let physMs = 0;
let simTime = 0, last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 0;
const benchStats = { frames: 0, total: 0, render: 0 };
const model = new Float32Array(16);

function frame(now        ) {
  const elapsed = (now - last) / 1000;
  last = now;
  R.resize();

  let stepped = 0;
  const alpha = loop.advance(BENCH ? 1 / 60 : elapsed, (dt) => {
    stepped++;
    savePrev();
    if (!BENCH) playerSystem(dt);
    moverSystem(simTime, dt);
    const pt = performance.now();
    phys.step(dt);
    physMs = physMs * 0.9 + (performance.now() - pt) * 0.1;
    triggerSystem();
    landingFx();
    world.flush();
    parts.update(dt);
    simTime += dt;
  });

  // interpolated player position for camera and drawing
  const pp = C.prev.get(player) ;
  const ip       = [lerp(pp[0], pBody.pos[0], alpha), lerp(pp[1], pBody.pos[1], alpha), lerp(pp[2], pBody.pos[2], alpha)];
  if (BENCH) { yaw += elapsed * 0.3; }
  updateCamera(Math.min(elapsed, 0.05), ip);

  const t0 = performance.now();
  R.begin(cam);
  for (const e of world.query("render")) {
    const r = C.render.get(e) ;
    const b = C.body.get(e);
    let pos      ;
    if (b) {
      const p = C.prev.get(e);
      pos = p ? [lerp(p[0], b.pos[0], alpha), lerp(p[1], b.pos[1], alpha), lerp(p[2], b.pos[2], alpha)] : b.pos;
    } else pos = C.prev.get(e) ;
    let rot = quatFromEuler(r.yaw ?? 0);
    if (C.gem.has(e)) {
      const g = C.gem.get(e) ;
      rot = quatFromEuler(simTime * 1.6 + g.phase);
      pos = [pos[0], pos[1] + Math.sin(simTime * 2 + g.phase) * 0.18, pos[2]];
    }
    fromTRS(pos, rot, r.size, model);
    R.draw(r.mesh, model, r.color, { emissive: r.emissive, rough: r.rough, checker: r.checker });
  }
  // lamp flicker
  lamps.forEach((_, i) => { R.lights[i].color = [3.2, 2.0, 1.0].map((c) => c * (0.9 + 0.1 * Math.sin(simTime * 13 + i * 2) * Math.sin(simTime * 7.3 + i)))        ; });
  // player: body, and a visor showing which way it faces
  const squash = pBody.grounded ? 1 : clamp(1 + pBody.vel[1] * 0.012, 0.85, 1.15);
  fromTRS(ip, quatFromEuler(facing), [0.9 / Math.sqrt(squash), 0.9 * squash, 0.9 / Math.sqrt(squash)], model);
  R.draw(meshes.ball, model, [0.95, 0.42, 0.18], { rough: 0.3 });
  const vx = ip[0] - Math.sin(facing) * 0.33, vz = ip[2] - Math.cos(facing) * 0.33;
  fromTRS([vx, ip[1] + 0.12, vz], quatFromEuler(facing), [0.42, 0.16, 0.12], model);
  R.draw(meshes.box, model, [0.15, 0.95, 1], { emissive: 2.5, shadow: false });
  // blob shadow helps judge jumps
  const ground = phys.raycast(ip, [0, -1, 0], 30, LAYER_WORLD, pBody);
  if (ground) {
    fromTRS([ip[0], ground.point[1] + 0.02, ip[2]], [0, 0, 0, 1], [0.8, 0.01, 0.8], model);
    R.draw(meshes.cyl, model, [0.05, 0.05, 0.05], { emissive: 0.6, shadow: false });
  }
  for (let i = 0; i < parts.count; i++) {
    const s = parts.size[i] * (parts.life[i] / parts.maxLife[i]);
    fromTRS([parts.pos[i * 3], parts.pos[i * 3 + 1], parts.pos[i * 3 + 2]], quatFromEuler(i), [s, s, s], model);
    R.draw(meshes.box, model, [parts.col[i * 3], parts.col[i * 3 + 1], parts.col[i * 3 + 2]], { emissive: 2, shadow: false, scale: s });
  }
  R.end(cam, simTime);
  const frameMs = performance.now() - t0;

  fpsAcc += elapsed; fpsN++;
  if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  if (started && !startTime) startTime = now;
  const secs = finished ? (finished - startTime) / 1000 : startTime ? (now - startTime) / 1000 : 0;
  hud.innerHTML =
    `<div><b>${collected} / ${totalGems}</b> crystals &nbsp; <b>${secs.toFixed(1)}s</b></div>` +
    `<span class="dim">${fps.toFixed(0)} fps &middot; ${R.stats.draws} draws &middot; ${R.stats.instances} instances &middot; ${phys.bodies.length} bodies (${phys.stats.sleeping} asleep) &middot; cpu ${frameMs.toFixed(2)} ms</span>`;
  if (finished && !banner.dataset.done) {
    banner.dataset.done = "1";
    banner.textContent = `All crystals in ${secs.toFixed(1)} s. Press R to play again.`;
    banner.className = "show";
  }
  if (input.pressed("KeyR")) location.reload();

  if (BENCH) {
    benchStats.frames++;
    benchStats.render += frameMs;
    (window                                       ).benchResult = {
      frames: benchStats.frames, physicsMs: +physMs.toFixed(3), cpuMsPerFrame: +(benchStats.render / benchStats.frames).toFixed(3),
      draws: R.stats.draws, instances: R.stats.instances, bodies: phys.bodies.length, sleeping: phys.stats.sleeping,
    };
  }
  input.endFrame(stepped > 0);
  requestAnimationFrame(frame);
}

canvas.addEventListener("mousedown", () => { sfx.unlock(); started = true; document.getElementById("intro") .className = "hide"; });
addEventListener("keydown", () => { sfx.unlock(); started = true; document.getElementById("intro") .className = "hide"; }, { once: false });
if (BENCH) document.getElementById("intro") .className = "hide";
(window                                 ).ember = { world, phys, R, player: pBody };
requestAnimationFrame(frame);
