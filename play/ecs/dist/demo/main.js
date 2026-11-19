/** Browser entry: canvas rendering with interpolation, input, HUD. */
import { FixedStep } from "../src/loop.js";
import { Game, TAG,            } from "./game.js";

const canvas = document.getElementById("view")                     ;
const ctx = canvas.getContext("2d")                            ;
const hud = document.getElementById("hud")               ;
const W = 1280, H = 720;
canvas.width = W;
canvas.height = H;

let game = new Game(W, H, Date.now() & 0xffff, 460);
const loop = new FixedStep(60);
const keys = new Set        ();
const input        = { left: false, right: false, thrust: false, fire: false };
let mouse                                  = null;
let mouseDown = false;
let debug = false;
let paused = false;

addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (e.code === "KeyH") debug = !debug;
  if (e.code === "KeyP") paused = !paused;
  if (e.code === "KeyR") game = new Game(W, H, Date.now() & 0xffff, game.targetAsteroids);
  if (e.code === "Digit1") game.targetAsteroids = 120;
  if (e.code === "Digit2") game.targetAsteroids = 460;
  if (e.code === "Digit3") game.targetAsteroids = 900;
  if (e.code === "Digit4") game.targetAsteroids = 2400;
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
});
addEventListener("keyup", (e) => keys.delete(e.code));
canvas.addEventListener("mousemove", (e) => {
  const r = canvas.getBoundingClientRect();
  mouse = { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
});
canvas.addEventListener("mousedown", () => { mouseDown = true; });
addEventListener("mouseup", () => { mouseDown = false; });
canvas.addEventListener("mouseleave", () => { mouse = null; });

// deterministic jagged outlines, cached per shape id
const shapes = new Map                      ();
function shape(id        )               {
  let s = shapes.get(id);
  if (!s) {
    const n = 11;
    s = new Float32Array(n * 2);
    let seed = id * 2654435761;
    for (let k = 0; k < n; k++) {
      seed = (seed ^ (seed >>> 13)) * 1274126177;
      const jitter = 0.72 + ((seed >>> 0) % 1000) / 1000 * 0.38;
      const a = (k / n) * Math.PI * 2;
      s[k * 2] = Math.cos(a) * jitter;
      s[k * 2 + 1] = Math.sin(a) * jitter;
    }
    shapes.set(id, s);
  }
  return s;
}

const timing = { update: 0, render: 0, fps: 0, frames: 0, acc: 0 };

function render(alpha        )       {
  const t0 = performance.now();
  const g = game, P = g.Pos.data, B = g.Body.data, tags = g.w.tags;
  const ix = (i        ) => P.px[i] + (P.x[i] - P.px[i]) * alpha;
  const iy = (i        ) => P.py[i] + (P.y[i] - P.py[i]) * alpha;
  ctx.fillStyle = "#0b0d10";
  ctx.fillRect(0, 0, W, H);

  // asteroids: one path, one stroke
  ctx.beginPath();
  const A = g.Ast.data, S = g.Spin.data;
  g.w.query([g.Ast], (i) => {
    const x = ix(i), y = iy(i), r = B.r[i], sh = shape(A.shape[i]), rot = S.a[i];
    const c = Math.cos(rot), s = Math.sin(rot);
    for (let k = 0; k < sh.length; k += 2) {
      const px = x + (sh[k] * c - sh[k + 1] * s) * r, py = y + (sh[k] * s + sh[k + 1] * c) * r;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  });
  ctx.strokeStyle = "#b8c1cc";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // bullets
  ctx.beginPath();
  const V = g.Vel.data;
  g.w.query([g.Pos, g.Life], (i) => {
    if (tags[i] !== TAG.BULLET) return;
    const x = ix(i), y = iy(i);
    ctx.moveTo(x, y);
    ctx.lineTo(x - V.x[i] * 0.012, y - V.y[i] * 0.012);
  });
  ctx.strokeStyle = "#ffd166";
  ctx.lineWidth = 2;
  ctx.stroke();

  // particles: bucket by fade level to keep fillStyle changes few
  const L = g.Life.data;
  for (let band = 4; band >= 1; band--) {
    ctx.fillStyle = `rgba(255,140,60,${band / 4})`;
    g.w.query([g.Life], (i) => {
      if (tags[i] !== TAG.PARTICLE) return;
      if (Math.ceil((L.t[i] / L.max[i]) * 4) !== band) return;
      ctx.fillRect(ix(i) - 1, iy(i) - 1, 2, 2);
    });
  }

  // ship
  if (g.w.alive(g.ship)) {
    const s = g.ship & 0xfffff;
    const x = ix(s), y = iy(s), a = g.shipAngle;
    if (g.invuln <= 0 || Math.floor(g.time * 10) % 2 === 0) {
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 15, y + Math.sin(a) * 15);
      ctx.lineTo(x + Math.cos(a + 2.5) * 11, y + Math.sin(a + 2.5) * 11);
      ctx.lineTo(x + Math.cos(a + Math.PI) * 5, y + Math.sin(a + Math.PI) * 5);
      ctx.lineTo(x + Math.cos(a - 2.5) * 11, y + Math.sin(a - 2.5) * 11);
      ctx.closePath();
      ctx.strokeStyle = "#7bdff2";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  if (debug) {
    ctx.strokeStyle = "rgba(120,200,120,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const cs = g.grid.cellSize;
    for (let x = 0; x <= W; x += cs) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0; y <= H; y += cs) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,80,80,0.5)";
    ctx.beginPath();
    g.w.query([g.Pos, g.Body], (i) => { ctx.moveTo(ix(i) + B.r[i], iy(i)); ctx.arc(ix(i), iy(i), B.r[i], 0, 6.283); });
    ctx.stroke();
  }
  timing.render = timing.render * 0.9 + (performance.now() - t0) * 0.1;
}

function drawHud()       {
  const s = game.stats;
  const ratio = s.bruteForcePairs ? (s.pairsChecked / s.bruteForcePairs) * 100 : 0;
  hud.textContent =
    `score ${game.score}   lives ${Math.max(0, game.lives)}${game.lives <= 0 ? "   GAME OVER (R to restart)" : ""}\n` +
    `${timing.fps.toFixed(0)} fps   entities ${s.entities}  (asteroids ${s.asteroids}, bullets ${s.bullets}, particles ${s.particles})\n` +
    `update ${timing.update.toFixed(2)} ms   render ${timing.render.toFixed(2)} ms   ` +
    `broadphase ${s.pairsChecked} checks vs ${s.bruteForcePairs} brute force (${ratio.toFixed(2)}%)   contacts ${s.collisions}`;
}

let last = performance.now();
function frame(now        )       {
  const elapsed = (now - last) / 1000;
  last = now;
  input.left = keys.has("ArrowLeft") || keys.has("KeyA");
  input.right = keys.has("ArrowRight") || keys.has("KeyD");
  input.thrust = keys.has("ArrowUp") || keys.has("KeyW");
  input.fire = keys.has("Space") || mouseDown;
  input.aimX = mouse && !input.left && !input.right ? mouse.x : undefined;
  input.aimY = mouse && !input.left && !input.right ? mouse.y : undefined;
  let alpha = 1;
  if (!paused) {
    const t0 = performance.now();
    alpha = loop.advance(elapsed, (dt) => game.step(dt, input));
    timing.update = timing.update * 0.9 + (performance.now() - t0) * 0.1;
  }
  render(alpha);
  timing.frames++;
  timing.acc += elapsed;
  if (timing.fps === 0 && timing.frames === 2) drawHud();
  if (timing.acc >= 0.5) {
    timing.fps = timing.frames / timing.acc;
    timing.frames = 0;
    timing.acc = 0;
    drawHud();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
