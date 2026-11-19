// Browser host for the wasm raycaster: input -> rc_frame -> blit framebuffer.
// No wasm-bindgen: the module exports plain C functions and its memory.
const RES = { "320x180": [320, 180], "480x270": [480, 270], "640x360": [640, 360], "960x540": [960, 540] };
const params = new URLSearchParams(location.search);
const canvas = document.getElementById("view");
const ctx = canvas.getContext("2d");
const hud = document.getElementById("hud");
const banner = document.getElementById("banner");
const resSel = document.getElementById("res");

const { instance } = await WebAssembly.instantiateStreaming(fetch("raycast.wasm"), {});
const rc = instance.exports;
let [W, H] = RES[params.get("res") || "640x360"] || RES["640x360"];
let seed = Number(params.get("seed")) || (Date.now() & 0xffff);
let mazeSize = Number(params.get("maze")) || 12;
rc.rc_init(seed, W, H, mazeSize, mazeSize);
let image = null;
function setRes(w, h) {
  W = w; H = h;
  rc.rc_resize(W, H);
  canvas.width = W;
  canvas.height = H;
  image = ctx.createImageData(W, H);
}
setRes(W, H);
resSel.value = `${W}x${H}`;
resSel.onchange = () => setRes(...RES[resSel.value]);

const keys = new Set();
const opts = { KeyM: [0, true], KeyL: [1, true], KeyF: [2, true], KeyT: [3, true], KeyX: [4, true] };
addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (opts[e.code]) { opts[e.code][1] = !opts[e.code][1]; rc.rc_option(opts[e.code][0], opts[e.code][1] ? 1 : 0); }
  if (e.code === "KeyN") { seed++; rc.rc_init(seed, W, H, mazeSize, mazeSize); banner.hidden = true; started = performance.now(); }
  if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
});
addEventListener("keyup", (e) => keys.delete(e.code));
let mouseDx = 0;
canvas.addEventListener("click", () => canvas.requestPointerLock?.());
addEventListener("mousemove", (e) => { if (document.pointerLockElement === canvas) mouseDx += e.movementX; });

function inputBits() {
  const k = (...c) => c.some((x) => keys.has(x));
  return (k("KeyW", "ArrowUp") ? 1 : 0) | (k("KeyS", "ArrowDown") ? 2 : 0) | (k("KeyA") ? 4 : 0) | (k("KeyD") ? 8 : 0) |
    (k("ArrowLeft", "KeyQ") ? 16 : 0) | (k("ArrowRight", "KeyE") ? 32 : 0) | (k("ShiftLeft", "ShiftRight") ? 64 : 0);
}

let last = performance.now(), started = last, wasmMs = 0, fps = 0, frames = 0, acc = 0;
function blit() {
  const ptr = rc.rc_fb();
  // memory.buffer can be replaced when wasm memory grows: always re-view it
  image.data.set(new Uint8ClampedArray(rc.memory.buffer, ptr, W * H * 4));
  ctx.putImageData(image, 0, 0);
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t0 = performance.now();
  const won = rc.rc_frame(dt, inputBits(), mouseDx);
  wasmMs = wasmMs * 0.9 + (performance.now() - t0) * 0.1;
  mouseDx = 0;
  blit();
  if (won && banner.hidden) {
    banner.hidden = false;
    banner.textContent = `Exit reached in ${((now - started) / 1000).toFixed(1)} s. Press N for a new maze.`;
  }
  frames++;
  acc += dt;
  if (acc > 0.5) {
    fps = frames / acc;
    frames = 0;
    acc = 0;
    hud.textContent = `${fps.toFixed(0)} fps   wasm ${wasmMs.toFixed(2)} ms/frame   ${W}x${H}   ` +
      `rays ${rc.rc_stat(3)}   dda steps ${rc.rc_stat(4)}   sprites ${rc.rc_stat(5)}   lights ${rc.rc_stat(6)}   seed ${seed}`;
  }
  requestAnimationFrame(frame);
}

if (params.has("bench")) {
  // headless benchmark: fixed input, N frames, result in window.__bench
  const out = {};
  for (const r of ["320x180", "640x360", "960x540"]) {
    setRes(...RES[r]);
    rc.rc_init(7, W, H, 12, 12);
    for (let i = 0; i < 20; i++) rc.rc_frame(1 / 60, 1, 0);
    const n = 200;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) rc.rc_frame(1 / 60, i % 4 === 0 ? 33 : 1, 0);
    out[r] = +((performance.now() - t0) / n).toFixed(3);
  }
  window.__bench = out;
  hud.textContent = "bench: " + JSON.stringify(out);
} else {
  if (params.has("demo")) {   // screenshot mode: walk forward a bit
    for (let i = 0; i < Number(params.get("demo") || 60); i++) rc.rc_frame(1 / 60, 1, 0);
  }
  requestAnimationFrame(frame);
  blit();
}
