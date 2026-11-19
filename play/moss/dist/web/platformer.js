/**
 * Demo: "Moss Ledge", a 2D platformer on ember's 2D layer.
 * Every sprite is painted into an atlas at startup, so there are no image files.
 */
import { Engine } from "../src/engine.js?v=122c782b";
import { Camera2D,                              } from "../src/sprites.js?v=122c782b";
import {           } from "../src/tilemap.js?v=122c782b";
import { buildMap, entities, stepPlayer, TILE, GRAV } from "./moss.js?v=122c782b";
import { clamp, damp, lerp, rng } from "../src/math.js?v=122c782b";
import { Animator, Library, decodePixels, loadSprite } from "../src/assets.js?v=122c782b";

const canvas = document.getElementById("view")                     ;
const eng = new Engine(canvas);
eng.autoPhysics = false;
eng.pixelArt = true;
if (new URLSearchParams(location.search).has("bench")) eng.deterministic = true;
const sb = eng.sprites, input = eng.input, sfx = eng.sfx;

// ---- pixel art atlas --------------------------------------------------
const atlas = document.createElement("canvas");
atlas.width = 256;
atlas.height = 64;
const g = atlas.getContext("2d") ;
const px = (x        , y        , w        , h        , c        ) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
const r = rng(4);
// 1 grass top
px(0, 0, 16, 16, "#6b4a32");
for (let i = 0; i < 18; i++) px(Math.floor(r() * 15), 5 + Math.floor(r() * 10), 2, 1, "#5a3d29");
px(0, 0, 16, 5, "#5fa04a"); px(0, 5, 16, 1, "#3f7a34");
for (let x = 0; x < 16; x += 3) px(x, 5, 1, 1 + Math.floor(r() * 2), "#5fa04a");
// 2 dirt
px(16, 0, 16, 16, "#6b4a32");
for (let i = 0; i < 22; i++) px(16 + Math.floor(r() * 15), Math.floor(r() * 15), 2, 1, "#5a3d29");
// 3 stone
px(32, 0, 16, 16, "#6e7078"); px(32, 0, 16, 1, "#8b8d95"); px(32, 8, 16, 1, "#5a5c63"); px(40, 0, 1, 8, "#5a5c63"); px(35, 8, 1, 8, "#5a5c63");
// 4 plank (one-way)
px(48, 0, 16, 5, "#b07a45"); px(48, 0, 16, 1, "#d39a5c"); px(48, 4, 16, 1, "#7a5230"); px(52, 1, 1, 3, "#7a5230"); px(59, 1, 1, 3, "#7a5230");
// 5 spikes
for (let k = 0; k < 2; k++) for (let y = 0; y < 12; y++) {
  const half = Math.min(4, Math.ceil((y + 1) / 3)); // widening triangle, tip at the top
  px(64 + k * 8 + 4 - half, 3 + y, half * 2, 1, y < 4 ? "#eef0f5" : "#9aa0ad");
  px(64 + k * 8 + 4 - half, 3 + y, 1, 1, "#6b7180");
}
px(64, 15, 16, 1, "#5a5f6b");
// coins, 4 frames at (80..143, 0)
[10, 7, 3, 7].forEach((w, f) => {
  const cx = 80 + f * 16 + 8;
  for (let y = 0; y < 10; y++) {
    const rw = Math.max(1, Math.round(w * Math.sqrt(1 - ((y - 4.5) / 5) ** 2))); // round rows
    px(Math.round(cx - rw / 2), 3 + y, rw, 1, y > 7 ? "#c8902c" : "#f2c14e");
  }
  if (w > 3) px(Math.round(cx - w / 4), 5, 1, 5, "#fff2b8");
});
// player frames at row 16: idle, run1, run2, jump
const hero = (ox        , legA        , legB        , armUp         ) => {
  const y = 16;
  px(ox + 4, y + 2, 8, 7, "#f0c8a0");          // head
  px(ox + 3, y + 1, 10, 3, "#3b2a5e");         // hair
  px(ox + 9, y + 5, 2, 2, "#1d1d24");          // eye
  px(ox + 4, y + 9, 8, 4, "#d9573b");          // shirt
  px(ox + (armUp ? 11 : 12), y + (armUp ? 6 : 9), 2, 3, "#f0c8a0");
  px(ox + 4 + legA, y + 13, 3, 3, "#2f3b66");
  px(ox + 9 + legB, y + 13, 3, 3, "#2f3b66");
};
hero(0, 0, 0, false); hero(16, -1, 1, false); hero(32, 1, -1, false); hero(48, -1, 1, true);
// slime, 2 frames at (64..95, 16)
const slime = (ox        , squish        ) => {
  const y = 16 + 6 + squish, h = 10 - squish;
  px(ox + 2, y, 12, h, "#6cc46a"); px(ox + 1, y + 2, 14, h - 2, "#6cc46a"); px(ox + 3, y + 1, 4, 2, "#a7eba0");
  px(ox + 5, y + 3, 2, 2, "#1d2a1d"); px(ox + 10, y + 3, 2, 2, "#1d2a1d"); px(ox + 1, y + h - 1, 14, 1, "#3e8a3d");
};
slime(64, 0); slime(80, 2);
// flag at (96,16), heart at (112,16), checkpoint at (128,16)
px(97, 16, 2, 16, "#cfd3dc"); px(99, 17, 10, 7, "#e34b4b"); px(99, 23, 10, 1, "#a33232");
const heart = (ox        , c        ) => { px(ox + 2, 19, 5, 4, c); px(ox + 9, 19, 5, 4, c); px(ox + 1, 21, 14, 4, c); px(ox + 3, 25, 10, 2, c); px(ox + 5, 27, 6, 2, c); px(ox + 7, 29, 2, 1, c); };
heart(112, "#e34b4b");
heart(144, "#3a3f4a");
px(129, 16, 2, 16, "#cfd3dc"); px(131, 17, 8, 6, "#4b8be3");
// particle dot at (160,16)
px(160, 16, 4, 4, "#ffffff");
const tex = sb.texture(atlas, true);
const F = (x        , y        , w = 16, h = 16)        => ({ tex, x, y, w, h });
const tileArt                        = [undefined, F(0, 0), F(16, 0), F(32, 0), F(48, 0), F(64, 0)];
const coinF = [0, 1, 2, 3].map((i) => F(80 + i * 16, 0));
const heroF = { idle: F(0, 16), run: [F(16, 16), F(32, 16)], jump: F(48, 16) };
const slimeF = [F(64, 16), F(80, 16)];
// A sprite named "hero" drawn in the editor's Sprites tab replaces the built-in
// player art. Its animations named idle / run / jump are used when present.
const custom = (() => {
  const a = Library.get("hero");
  // ignore an empty sprite (the editor creates a blank "hero" to start from)
  return a && a.frames.some((f) => decodePixels(f, a.w, a.h).some((v, i) => i % 4 === 3 && v > 0)) ? a : undefined;
})();
const heroAnim = custom ? new Animator(loadSprite(sb, custom), "idle") : null;
const flagF = F(96, 16), heartF = F(112, 16), heartEmpty = F(144, 16), checkF = F(128, 16), dotF = F(160, 16, 4, 4);

// ---- level (data and movement live in moss.ts, shared with the reachability test) ----
const map = buildMap(), ents = entities();
const spikesAt = (x        , y        ) => map.get(Math.floor(x / TILE), Math.floor(y / TILE)) === 5;

                                                     
                                                                                   
const coins         = ents.coins.map((c) => ({ ...c, got: false }));
const slimes          = ents.slimes.map((p) => ({ b: { x: p.x, y: p.y, w: 12, h: 12 }, vx: -28, vy: 0, alive: true, squash: 0 }));
const checkpoints = ents.checkpoints, spawn = ents.spawn, goal = ents.goal;

// ---- player ----------------------------------------------------------------
const P = { b: { x: spawn.x, y: spawn.y, w: 10, h: 14 }, vx: 0, vy: 0, face: 1, grounded: false, coyote: 0, buffer: 0, hearts: 3, hurt: 0, anim: 0 };
let respawn = { ...spawn }, coinsGot = 0, won = false, time = 0, deaths = 0;
const cam = new Camera2D();
cam.pixelSnap = true;
cam.x = spawn.x;
cam.y = spawn.y;

                                                                                       
const dots        = [];
const burst = (x        , y        , c        , n        , sp        ) => {
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = sp * (0.3 + Math.random() * 0.7); dots.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - sp * 0.4, life: 0.4 + Math.random() * 0.4, c }); }
};


function hurt() {
  if (P.hurt > 0 || won) return;
  P.hearts--;
  P.hurt = 1.2;
  cam.shake = 4;
  sfx.land(4);
  burst(P.b.x + 5, P.b.y + 7, 0xe34b4bff, 16, 120);
  if (P.hearts <= 0) {
    deaths++;
    P.hearts = 3;
    P.b.x = respawn.x; P.b.y = respawn.y; P.vx = P.vy = 0;
  } else { P.vy = -200; P.vx = -P.face * 120; }
}

// previous-step positions, so drawing can blend between 60 Hz steps on any refresh rate
const prevP = { x: P.b.x, y: P.b.y };
const prevS = new Map                                 ();
function fixedUpdate(dt        ) {
  prevP.x = P.b.x; prevP.y = P.b.y;
  for (const s of slimes) prevS.set(s, { x: s.b.x, y: s.b.y });
  if (won) return;
  time += dt;
  const r = stepPlayer(P, {
    x: input.axes().x,
    run: input.held("ShiftLeft") || input.held("ShiftRight"),
    jumpPressed: input.pressed("Space") || input.pressed("KeyW") || input.pressed("ArrowUp") || input.padButton(0),
    jumpHeld: input.held("Space") || input.held("KeyW") || input.held("ArrowUp") || input.padButton(0),
    drop: input.held("KeyS") || input.held("ArrowDown"),
  }, map, dt);
  if (r.jumped) { sfx.jump(); burst(P.b.x + 5, P.b.y + 14, 0xd8d0c0ff, 6, 40); }
  const fallSpeed = r.fallSpeed;
  if (r.landed && fallSpeed > 250) { sfx.land(fallSpeed / 120); burst(P.b.x + 5, P.b.y + 14, 0xb8a890ff, 8, 50); }
  P.hurt = Math.max(0, P.hurt - dt);
  P.anim += dt * Math.abs(P.vx) * 0.08;

  if (P.b.y > map.h * TILE + 40) { P.hearts = 1; hurt(); }
  if (spikesAt(P.b.x + 2, P.b.y + P.b.h) || spikesAt(P.b.x + P.b.w - 2, P.b.y + P.b.h)) hurt();

  for (const c of coins) {
    if (c.got) continue;
    if (Math.abs(P.b.x + 5 - c.x) < 10 && Math.abs(P.b.y + 7 - c.y) < 11) {
      c.got = true; coinsGot++; sfx.pickup(1 + coinsGot * 0.02); burst(c.x, c.y, 0xf2c14eff, 10, 70);
    }
  }
  for (const s of slimes) {
    if (!s.alive) { s.squash += dt; continue; }
    s.vy = Math.min(s.vy + GRAV * dt, 400);
    const sr = map.moveAndCollide(s.b, s.vx * dt, s.vy * dt);
    if (sr.hitY) s.vy = 0;
    // turn at walls and ledges
    const ahead = s.vx > 0 ? s.b.x + s.b.w + 1 : s.b.x - 1;
    if (sr.hitX || (sr.onGround && !map.isSolid(Math.floor(ahead / TILE), Math.floor((s.b.y + s.b.h + 2) / TILE)))) s.vx = -s.vx;
    const o = P.b, q = s.b;
    if (o.x < q.x + q.w && o.x + o.w > q.x && o.y < q.y + q.h && o.y + o.h > q.y) {
      if (P.vy > 40 && o.y + o.h - q.y < 8) {
        s.alive = false; P.vy = -230; cam.shake = 3; sfx.bump(8); burst(q.x + 6, q.y + 6, 0x6cc46aff, 18, 110);
      } else hurt();
    }
  }
  for (const c of checkpoints) if (Math.abs(P.b.x - c.x) < 12 && Math.abs(P.b.y - c.y) < 20 && respawn.x !== c.x) { respawn = { x: c.x, y: c.y }; sfx.pad(); }
  if (Math.abs(P.b.x - goal.x) < 14 && Math.abs(P.b.y - goal.y) < 24) { won = true; sfx.win(); burst(goal.x + 8, goal.y, 0xffe08aff, 60, 160); }

  for (let i = dots.length - 1; i >= 0; i--) {
    const d = dots[i];
    d.vy += 500 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.life -= dt;
    if (d.life <= 0) { dots[i] = dots[dots.length - 1]; dots.pop(); }
  }
}

let alphaNow = 1;
/** Interpolated player position for this rendered frame. */
const plX = () => lerp(prevP.x, P.b.x, alphaNow), plY = () => lerp(prevP.y, P.b.y, alphaNow);

function update(dt        , alpha        ) {
  alphaNow = alpha;
  const vw = canvas.width, vh = canvas.height; // device pixels (pixelArt mode)
  // whole screen pixels per art pixel: about 11 tiles tall, never fractional
  cam.zoom = Math.max(1, Math.round(vh / (11 * TILE)));
  // look ahead in the facing direction, and slightly above the player
  const tx = plX() + 5 + P.face * 28 + P.vx * 0.15, ty = plY() - 10;
  cam.x = lerp(cam.x, tx, damp(5, dt));
  cam.y = lerp(cam.y, ty, damp(3.5, dt));
  const hw = vw / 2 / cam.zoom, hh = vh / 2 / cam.zoom;
  cam.x = clamp(cam.x, hw, map.w * TILE - hw);
  cam.y = clamp(cam.y, hh - 4 * TILE, map.h * TILE - hh);
  cam.update(dt);
  if (input.pressed("KeyR")) location.reload();
}

function hills(sb             , w        , h        , par        , color        , base        , amp        , seed        ) {
  // parallax silhouettes on the same art-pixel grid as the level: columns one
  // art pixel wide, offsets and heights in whole art pixels
  const z = cam.zoom;
  const off = Math.round(cam.x * par); // in art pixels
  const cols = Math.ceil(w / z) + 1;
  for (let i = 0; i < cols; i++) {
    const wx = (i + off) / 45 + seed;
    const top = base + Math.sin(wx) * amp + Math.sin(wx * 2.3 + seed) * amp * 0.4;
    sb.rect(i * z, Math.round((h * top) / z) * z, z, h, color);
  }
}

function draw2d(sb             , w        , h        ) {
  // sky gradient and parallax layers in screen space
  for (let i = 0; i < 12; i++) { const t = i / 11; sb.rect(0, Math.floor((h * i) / 12), w, Math.ceil(h / 12) + 1, ((Math.round(lerp(0x8f, 0xe6, t)) << 24) | (Math.round(lerp(0xc4, 0xe9, t)) << 16) | (Math.round(lerp(0xf0, 0xd8, t)) << 8) | 0xff) >>> 0); }
  hills(sb, w, h, 0.15, 0xa9c7b6ff, 0.55, 0.07, 1);
  hills(sb, w, h, 0.35, 0x7fae86ff, 0.68, 0.06, 4);
  sb.flush();

  // world
  sb.begin(w, h, cam);
  map.draw(sb, tileArt, cam, w, h);
  const t = eng.time;
  for (const c of coins) if (!c.got) sb.draw(coinF[Math.floor(t * 8 + c.x) % 4], c.x, c.y + Math.sin(t * 3 + c.x) * 1.5);
  for (const c of checkpoints) sb.draw(checkF, c.x + 8, c.y + 8, 16, 16, { color: respawn.x === c.x ? 0xffffffff : 0x9aa0aaff });
  sb.draw(flagF, goal.x + 8, goal.y + 8);
  for (const s of slimes) {
    const q = prevS.get(s) ?? s.b, sx = lerp(q.x, s.b.x, alphaNow), sy = lerp(q.y, s.b.y, alphaNow);
    if (s.alive) sb.draw(slimeF[Math.floor(t * 4 + s.b.x * 0.01) % 2], sx + 6, sy + 2, 16, 16, { flipX: s.vx > 0 });
    else if (s.squash < 0.4) sb.draw(slimeF[1], s.b.x + 6, s.b.y + 10, 16 + s.squash * 20, 6 * (1 - s.squash * 2), { color: 0xffffffaa });
  }
  const blink = P.hurt > 0 && Math.floor(P.hurt * 12) % 2 === 0;
  if (!blink) {
    const state = !P.grounded ? "jump" : Math.abs(P.vx) > 15 ? "run" : "idle";
    if (heroAnim) {
      heroAnim.play(state);
      heroAnim.update(1 / 60);
      const fr = heroAnim.frame();
      sb.draw(fr, plX() + 5, plY() + 14 - fr.h / 2, fr.w, fr.h, { flipX: P.face < 0 });
    } else {
      const f = state === "jump" ? heroF.jump : state === "run" ? heroF.run[Math.floor(P.anim) % 2] : heroF.idle;
      sb.draw(f, plX() + 5, plY() + 6, 16, 16, { flipX: P.face < 0 });
    }
  }
  for (const d of dots) sb.draw(dotF, d.x, d.y, 2, 2, { color: d.c });
  sb.flush();

  // HUD: sizes in CSS pixels times the device pixel ratio; icons at whole multiples
  sb.begin(w, h);
  const u = eng.dpr, icon = Math.max(1, Math.round(2 * u)) * 16;
  for (let i = 0; i < 3; i++) sb.draw(i < P.hearts ? heartF : heartEmpty, Math.round(14 * u) + i * (icon + Math.round(2 * u)), Math.round(14 * u), icon, icon, { ox: 0, oy: 0 });
  sb.draw(coinF[0], Math.round(14 * u), Math.round(20 * u) + icon, icon, icon, { ox: 0, oy: 0 });
  sb.text(`${coinsGot} / ${coins.length}`, Math.round(18 * u) + icon, Math.round(22 * u) + icon, 22 * u, 0xffffffff);
  sb.text(`${time.toFixed(1)} s`, w - 24 * u, 20 * u, 22 * u, 0xffffffff, 1);
  if (deaths) sb.text(`${deaths} ${deaths === 1 ? "restart" : "restarts"}`, w - 24 * u, 48 * u, 15 * u, 0xffffffcc, 1);
  if (time < 5 && !won) sb.text("A D to move   Space to jump   Shift to run   S to drop through planks", w / 2, h - 46 * u, 18 * u, 0xffffffdd, 0.5);
  if (won) {
    sb.rect(w / 2 - 230 * u, h / 2 - 60 * u, 460 * u, 120 * u, 0x000000aa);
    sb.text("Level complete", w / 2, h / 2 - 44 * u, 34 * u, 0xffe08aff, 0.5);
    sb.text(`${coinsGot} of ${coins.length} coins in ${time.toFixed(1)} s.  R to replay`, w / 2, h / 2 + 8 * u, 18 * u, 0xffffffff, 0.5);
  }
}

eng.run({ fixedUpdate, update, draw2d });
(window                                ).game = { P, eng, coins };
