// Browser host: input -> wasm (rc_frame) -> blit the framebuffer, plus the HUD.
// No wasm-bindgen: the module exports plain C functions and its memory.
const $ = (id) => document.getElementById(id);
const canvas = $("view");
const ctx = canvas.getContext("2d", { alpha: false });
const params = new URLSearchParams(location.search);

const { instance } = await WebAssembly.instantiateStreaming(fetch("deadmaze.wasm"), {});
const rc = instance.exports;
if (params.has("debug") || location.hostname === "127.0.0.1") window.__rc = rc; // local testing only

// internal resolution: 270 rows (chunky pixels, cheap), width follows the window
let W = 480, H = 270, image = null;
function fit() {
  const rows = Number(params.get("rows")) || (matchMedia("(pointer: coarse)").matches ? 216 : 270);
  H = rows;
  W = Math.max(240, Math.min(960, Math.round((rows * innerWidth) / innerHeight / 2) * 2));
  rc.rc_resize(W, H);
  canvas.width = W;
  canvas.height = H;
  image = ctx.createImageData(W, H);
}
let seed = Number(params.get("seed")) || ((Date.now() & 0xffff) | 1);
function newGame() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  rc.rc_init(seed, W, H, 10, 10);
  rc.rc_option(0, 0); // minimap off by default
  fit();
}
rc.rc_init(seed, W, H, 10, 10);
rc.rc_option(0, 0);
fit();
addEventListener("resize", fit);

// ---------------------------------------------------------------- input
const FWD = 1, BACK = 2, SL = 4, SR = 8, TL = 16, TR = 32, RUN = 64, FIRE = 128;
const keys = new Set();
let mouseDx = 0, firing = false, running = false, map = false;
addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (e.code.startsWith("Digit")) rc.rc_weapon(Number(e.code.slice(5)) - 1);
  if (e.code === "KeyM") { map = !map; rc.rc_option(0, map ? 1 : 0); }
  if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => { keys.clear(); firing = false; });
canvas.addEventListener("mousedown", (e) => {
  if (!running) return;
  if (document.pointerLockElement !== canvas) { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* not allowed here */ } return; }
  if (e.button === 0) firing = true;
});
addEventListener("mouseup", (e) => { if (e.button === 0) firing = false; });
addEventListener("mousemove", (e) => { if (document.pointerLockElement === canvas) mouseDx += e.movementX; });
addEventListener("wheel", (e) => cycle(e.deltaY > 0 ? 1 : -1), { passive: true });
document.addEventListener("pointerlockchange", () => {
  // Esc releases the mouse: that is the pause
  if (!document.pointerLockElement && running && !touch) pause(true);
});
function cycle(d) {
  const owned = rc.rc_stat(18);
  let g = rc.rc_stat(11);
  for (let i = 0; i < 3; i++) { g = (g + d + 3) % 3; if (owned & (1 << g)) { rc.rc_weapon(g); return; } }
}

// touch: left stick moves, drag anywhere else to look, red button fires
const touch = matchMedia("(pointer: coarse)").matches;
let stick = { id: null, x: 0, y: 0, dx: 0, dy: 0 }, look = { id: null, x: 0 };
if (touch) {
  const s = $("stick"), knob = $("knob");
  addEventListener("touchstart", (e) => {
    for (const t of e.changedTouches) {
      const r = s.getBoundingClientRect();
      if (t.target === $("fire")) { firing = true; continue; }
      if (t.target === $("swap")) { cycle(1); continue; }
      if (t.clientX < innerWidth * 0.45 && stick.id === null) { stick = { id: t.identifier, x: r.left + r.width / 2, y: r.top + r.height / 2, dx: 0, dy: 0 }; }
      else if (look.id === null) look = { id: t.identifier, x: t.clientX };
    }
  }, { passive: true });
  addEventListener("touchmove", (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stick.id) {
        stick.dx = Math.max(-1, Math.min(1, (t.clientX - stick.x) / 50));
        stick.dy = Math.max(-1, Math.min(1, (t.clientY - stick.y) / 50));
        knob.style.transform = `translate(${stick.dx * 35}px, ${stick.dy * 35}px)`;
      } else if (t.identifier === look.id) { mouseDx += (t.clientX - look.x) * 2.2; look.x = t.clientX; }
    }
  }, { passive: true });
  const end = (e) => {
    for (const t of e.changedTouches) {
      if (t.target === $("fire")) firing = false;
      if (t.identifier === stick.id) { stick.id = null; stick.dx = stick.dy = 0; knob.style.transform = ""; }
      if (t.identifier === look.id) look.id = null;
    }
  };
  addEventListener("touchend", end, { passive: true });
  addEventListener("touchcancel", end, { passive: true });
}

function inputBits() {
  const k = (...c) => c.some((x) => keys.has(x));
  let b = (k("KeyW", "ArrowUp") ? FWD : 0) | (k("KeyS", "ArrowDown") ? BACK : 0) | (k("KeyA") ? SL : 0) | (k("KeyD") ? SR : 0) |
    (k("ArrowLeft", "KeyQ") ? TL : 0) | (k("ArrowRight", "KeyE") ? TR : 0) | (k("ShiftLeft", "ShiftRight") ? RUN : 0);
  if (stick.id !== null) {
    if (stick.dy < -0.3) b |= FWD; if (stick.dy > 0.3) b |= BACK;
    if (stick.dx < -0.3) b |= SL; if (stick.dx > 0.3) b |= SR;
    if (Math.hypot(stick.dx, stick.dy) > 0.9) b |= RUN;
  }
  return b | (firing || k("Space") ? FIRE : 0);
}

// ---------------------------------------------------------------- HUD (DOM writes only when a value changes)
const NAMES = ["PISTOL", "SHOTGUN", "RIFLE"];
const LOOT = { 4: "+40 BULLETS", 5: "+8 SHELLS", 6: "+30 HEALTH", 7: "SHOTGUN", 8: "RIFLE" };
const shown = {};
const set = (id, v) => { if (shown[id] !== v) { shown[id] = v; $(id).textContent = v; } };
let best = 0;
try { best = Number(localStorage.getItem("deadmaze.best")) || 0; } catch { /* private mode */ }
set("best", String(best));
let toastT = 0, lastPickup = 0, lastWave = 0;
function toast(text) { $("toast").textContent = text; $("toast").classList.add("on"); toastT = 1.6; }
function hud(dt) {
  const hp = Math.ceil(rc.rc_stat(10));
  set("hp", String(hp));
  if (shown.hpw !== hp) { shown.hpw = hp; $("hpbar").style.width = hp + "%"; $("hpbox").classList.toggle("low", hp <= 30); }
  const gun = rc.rc_stat(11), ammo = rc.rc_stat(12), owned = rc.rc_stat(18);
  set("gunname", NAMES[gun]);
  set("ammo", ammo < 0 ? "INF" : String(ammo));
  const gk = `${gun}${owned}`;
  if (shown.gk !== gk) { shown.gk = gk; for (let i = 0; i < 3; i++) $("g" + i).className = (owned & (1 << i) ? "have" : "") + (i === gun ? " cur" : ""); }
  const wave = rc.rc_stat(13);
  set("wave", String(wave));
  set("left", String(rc.rc_stat(15)));
  set("score", String(rc.rc_stat(14)));
  if (wave !== lastWave && wave > 0) { lastWave = wave; toast(`WAVE ${wave}`); }
  const pn = rc.rc_stat(20);
  if (pn !== lastPickup) { lastPickup = pn; toast(LOOT[rc.rc_stat(19)] ?? ""); }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $("toast").classList.remove("on"); }
}

// ---------------------------------------------------------------- loop
function blit() {
  // memory.buffer can be replaced when wasm memory grows: always re-view it
  image.data.set(new Uint8ClampedArray(rc.memory.buffer, rc.rc_fb(), W * H * 4));
  ctx.putImageData(image, 0, 0);
}
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (running) {
    rc.rc_frame(dt, inputBits(), mouseDx);
    mouseDx = 0;
    blit();
    hud(dt);
    if (rc.rc_stat(16)) die();
  }
  requestAnimationFrame(frame);
}

function start() {
  $("start").hidden = true;
  $("over").hidden = true;
  running = true;
  last = performance.now();
  if (!touch) try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* not allowed here */ }
}
function pause(on) {
  running = !on;
  if (on) { $("start").hidden = false; $("play").textContent = "RESUME"; }
}
function die() {
  running = false;
  firing = false;
  document.exitPointerLock?.();
  const score = rc.rc_stat(14);
  if (score > best) { best = score; try { localStorage.setItem("deadmaze.best", String(best)); } catch { /* private mode */ } set("best", String(best)); }
  $("summary").textContent = `Wave ${rc.rc_stat(13)}. ${rc.rc_stat(17)} kills. Score ${score}${score >= best && score > 0 ? ", a new best" : ""}.`;
  $("over").hidden = false;
}
$("play").onclick = start;
$("again").onclick = () => { newGame(); lastWave = 0; lastPickup = 0; start(); };

// first frame behind the start screen
rc.rc_frame(1 / 60, 0, 0);
blit();
if (params.has("auto")) start(); // screenshots and tests
requestAnimationFrame(frame);
