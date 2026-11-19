/**
 * ember editor: build 3D scenes in the browser and save them as JSON that
 * games load with spawnScene().
 *
 * Viewport: left click selects, left drag moves on the ground plane (Alt for
 * height), right drag orbits, middle or Shift+right drag pans, wheel zooms.
 * Keys: Del delete, Ctrl+D duplicate, Ctrl+Z / Ctrl+Y undo/redo, F focus,
 * arrows nudge, Ctrl+P play/stop.
 */
import { Engine } from "../src/engine.js";
import { World } from "../src/ecs.js";
import { PhysicsWorld, rayBody,           } from "../src/physics.js";
import {                                                             spawnScene, savePrevious, syncAndDraw } from "../src/scene.js";
import {            clamp, damp, fromTRS, lerp, normalize, quatFromEuler } from "../src/math.js";
import { ScriptRuntime } from "../src/script.js";
import { initSpriteEditor } from "./sprite-editor.js";
import { setupScriptsTab } from "./scripts-tab.js";

const $ =                        (id        ) => document.getElementById(id)     ;
const canvas = $                   ("view");
const eng = new Engine(canvas);
eng.autoPhysics = false;
const R = eng.renderer;

// ---- state -----------------------------------------------------------------
const STORE = "ember.editor.scene.v2";
const DEFAULT        = {
  version: 1, name: "untitled", fog: 0.0065,
  scripts: {
    player: `// Attached to "player". Runs every fixed step (60 per second).
function start(self, game) {
  game.state.score = 0;
  game.follow(self, 9, 4);          // camera follows this object
}

function update(self, game, dt) {
  const m = game.input.axes();      // WASD / arrows / gamepad
  const speed = game.input.held("ShiftLeft") ? 9 : 6;
  // move relative to where the camera looks
  const cam = game.camera, fx = cam.target[0] - cam.pos[0], fz = cam.target[2] - cam.pos[2];
  const l = Math.hypot(fx, fz) || 1, f = [fx / l, fz / l], r = [-f[1], f[0]];
  const v = self.velocity;
  self.velocity = [(f[0] * m.y + r[0] * m.x) * speed, v[1], (f[1] * m.y + r[1] * m.x) * speed];
  if (game.input.pressed("Space") && self.grounded) {
    self.velocity = [self.velocity[0], 9, self.velocity[2]];
    game.sound.jump();
  }
  if (self.position[1] < -10) self.position = [0, 4, 6];
  game.print("Crystals: " + game.state.score + " / " + game.state.total);
}

function onTrigger(self, other, game) {
  if (other.tag === "coin") {
    other.destroy();
    game.state.score++;
    game.sound.pickup(1 + game.state.score * 0.05);
  }
}`,
    spin: `// Spins and bobs the object it is attached to.
function start(self, game) {
  self.state.y = self.position[1];
  game.state.total = game.findAll("coin").length;
}
function update(self, game) {
  self.rotation += 0.04;
  const p = self.position;
  self.position = [p[0], self.state.y + Math.sin(game.time * 2) * 0.2, p[2]];
}`,
  },
  objects: [
    { name: "player", mesh: "sphere", pos: [0, 2, 6], size: [0.9, 0.9, 0.9], color: [0.95, 0.42, 0.18], body: "dynamic", mass: 2, rough: 0.3, friction: 0, script: "player" },
    { name: "ground", mesh: "box", pos: [0, -0.5, 0], size: [30, 1, 30], color: [0.42, 0.55, 0.38], checker: true, rough: 0.95, body: "static" },
    { name: "tower", mesh: "box", pos: [0, 1, 0], size: [4, 2, 4], color: [0.62, 0.63, 0.66], body: "static" },
    { name: "ramp", mesh: "box", pos: [5, 0.5, -3], size: [3, 1, 6], color: [0.55, 0.45, 0.35], body: "static", yaw: 0.3 },
    { name: "crate", mesh: "box", pos: [-3, 4, 2], size: [1, 1, 1], color: [0.7, 0.48, 0.28], body: "dynamic", mass: 2 },
    { name: "crate 2", mesh: "box", pos: [-3.2, 6, 2.3], size: [1, 1, 1], color: [0.7, 0.48, 0.28], body: "dynamic", mass: 2 },
    { name: "ball", mesh: "sphere", pos: [1.2, 6, 0.6], size: [1, 1, 1], color: [0.85, 0.3, 0.25], body: "dynamic", mass: 1, bounce: 0.6, rough: 0.2 },
    { name: "lamp", mesh: "sphere", pos: [-5, 2.5, -4], size: [0.5, 0.5, 0.5], color: [1, 0.75, 0.4], emissive: 3, body: "none", light: { color: [3, 2, 1], radius: 8 } },
    { name: "crystal", mesh: "gem", pos: [0, 3, 0], size: [0.9, 1.3, 0.9], color: [0.4, 0.9, 1], emissive: 2.2, body: "trigger", tag: "coin", script: "spin", light: { color: [0.6, 1.6, 2], radius: 4 } },
    { name: "crystal 2", mesh: "gem", pos: [8, 1.2, 6], size: [0.9, 1.3, 0.9], color: [0.4, 0.9, 1], emissive: 2.2, body: "trigger", tag: "coin", script: "spin" },
    { name: "crystal 3", mesh: "gem", pos: [-8, 1.2, -6], size: [0.9, 1.3, 0.9], color: [0.4, 0.9, 1], emissive: 2.2, body: "trigger", tag: "coin", script: "spin" },
  ],
};
let scene        = load() ?? structuredClone(DEFAULT);
let selected = -1;
let snap = true;
const undo           = [], redo           = [];
let playing                                                                                   = null;

function load()               {
  try { const s = localStorage.getItem(STORE); return s ? JSON.parse(s) : null; } catch { return null; }
}
function persist() { try { localStorage.setItem(STORE, JSON.stringify(scene)); } catch { /* storage unavailable */ } }
/** Call before any edit so it can be undone. */
function checkpoint() {
  undo.push(JSON.stringify(scene));
  if (undo.length > 200) undo.shift();
  redo.length = 0;
}
function restore(json        ) { scene = JSON.parse(json); selected = Math.min(selected, scene.objects.length - 1); refresh(); }

// ---- camera ------------------------------------------------------------------
const orbit = { yaw: 0.8, pitch: 0.55, dist: 22, target: [0, 1, 0]         };
function applyCamera() {
  const c = eng.camera, cp = Math.cos(orbit.pitch);
  c.target = [...orbit.target]        ;
  c.pos = [orbit.target[0] + Math.sin(orbit.yaw) * cp * orbit.dist, orbit.target[1] + Math.sin(orbit.pitch) * orbit.dist, orbit.target[2] + Math.cos(orbit.yaw) * cp * orbit.dist];
}

// ---- picking -------------------------------------------------------------------
function pick(px        , py        )         {
  applyCamera();
  const { origin, dir } = R.screenRay(px, py, eng.camera);
  let best = -1, bestT = Infinity;
  scene.objects.forEach((o, i) => {
    const sphere = o.mesh === "sphere" || o.mesh === "gem";
    const half       = [o.size[0] / 2, Math.max(o.size[1] / 2, 0.05), o.size[2] / 2];
    const tmp = { pos: o.pos, shape: sphere ? { kind: "sphere"         , r: Math.max(...o.size) / 2 } : { kind: "box"         , half } }        ;
    const h = rayBody(origin, dir, tmp);
    if (h && h.t < bestT) { bestT = h.t; best = i; }
  });
  return best;
}

function groundPoint(px        , py        , y        )              {
  const { origin, dir } = R.screenRay(px, py, eng.camera);
  if (Math.abs(dir[1]) < 1e-4) return null;
  const t = (y - origin[1]) / dir[1];
  return t > 0 ? [origin[0] + dir[0] * t, y, origin[2] + dir[2] * t] : null;
}

const snapTo = (v        , s = 0.5) => (snap ? Math.round(v / s) * s : Math.round(v * 1000) / 1000);

let drag                                                                                                                      = null;
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  if (e.button === 2 && !e.shiftKey) drag = { mode: "orbit", x, y, moved: false };
  else if (e.button === 1 || (e.button === 2 && e.shiftKey)) drag = { mode: "pan", x, y, moved: false };
  else if (e.button === 0 && !playing) {
    const hit = pick(x, y);
    select(hit);
    if (hit >= 0) {
      const o = scene.objects[hit];
      checkpoint();
      drag = { mode: e.altKey ? "lift" : "move", x, y, start: [...o.pos]        , grab: groundPoint(x, y, o.pos[1]) ?? o.pos, moved: false };
    }
  }
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  const dx = x - drag.x, dy = y - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
  if (drag.mode === "orbit") {
    orbit.yaw -= dx * 0.008; orbit.pitch = clamp(orbit.pitch + dy * 0.006, -0.1, 1.5);
    drag.x = x; drag.y = y;
  } else if (drag.mode === "pan") {
    // move the target opposite to the drag, in the ground plane, relative to the view
    const s = orbit.dist * 0.0018, cy = Math.cos(orbit.yaw), sy = Math.sin(orbit.yaw);
    const right       = [cy, 0, -sy], fwd       = [-sy, 0, -cy];
    orbit.target[0] += (-right[0] * dx + fwd[0] * dy) * s;
    orbit.target[2] += (-right[2] * dx + fwd[2] * dy) * s;
    drag.x = x; drag.y = y;
  } else if (selected >= 0 && drag.start && drag.grab) {
    const o = scene.objects[selected];
    if (drag.mode === "lift") {
      o.pos[1] = snapTo(drag.start[1] - dy * orbit.dist * 0.003);
    } else {
      const p = groundPoint(x, y, drag.start[1]);
      if (p) { o.pos[0] = snapTo(drag.start[0] + p[0] - drag.grab[0]); o.pos[2] = snapTo(drag.start[2] + p[2] - drag.grab[2]); }
    }
    fillInspector();
  }
});
canvas.addEventListener("pointerup", () => {
  if (drag && (drag.mode === "move" || drag.mode === "lift") && !drag.moved) undo.pop(); // a click, not an edit
  if (drag?.moved) persist();
  drag = null;
});
canvas.addEventListener("wheel", (e) => { orbit.dist = clamp(orbit.dist * Math.exp(e.deltaY * 0.001), 3, 120); e.preventDefault(); }, { passive: false });

// ---- UI: hierarchy + inspector -------------------------------------------------
const list = $("list"), insp = $("inspector");
function select(i        ) { selected = i; renderList(); fillInspector(); }

function renderList() {
  list.innerHTML = "";
  scene.objects.forEach((o, i) => {
    const li = document.createElement("li");
    li.className = i === selected ? "sel" : "";
    li.innerHTML = `<span class="sw" style="background:${hex(o.color)}"></span><span class="nm"></span><span class="kind">${o.light ? "light" : o.body ?? "static"}</span>`;
    li.querySelector(".nm") .textContent = o.name;
    li.onclick = () => select(i);
    li.ondblclick = () => { orbit.target = [...o.pos]        ; };
    list.appendChild(li);
  });
  $("count").textContent = String(scene.objects.length);
}

const hex = (c      ) => "#" + c.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, "0")).join("");
const unhex = (h        )       => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)        ;

                                                                                                                                                                                                                                                           
const FIELDS          = [
  { key: "name", label: "Name", type: "text", get: (o) => o.name, set: (o, v) => (o.name = String(v)) },
  { key: "mesh", label: "Mesh", type: "select", opts: ["box", "sphere", "cylinder", "gem", "plane"], get: (o) => o.mesh, set: (o, v) => (o.mesh = v            ) },
  { key: "pos", label: "Position", type: "vec3", step: 0.5, get: (o) => o.pos, set: (o, v) => (o.pos = v        ) },
  { key: "size", label: "Size", type: "vec3", step: 0.25, get: (o) => o.size, set: (o, v) => (o.size = (v        ).map((x) => Math.max(0.05, x))        ) },
  { key: "yaw", label: "Rotation Y (deg)", type: "num", step: 15, get: (o) => Math.round(((o.yaw ?? 0) * 180) / Math.PI), set: (o, v) => (o.yaw = (Number(v) * Math.PI) / 180) },
  { key: "color", label: "Color", type: "color", get: (o) => hex(o.color), set: (o, v) => (o.color = unhex(String(v))) },
  { key: "emissive", label: "Glow", type: "num", step: 0.5, get: (o) => o.emissive ?? 0, set: (o, v) => (o.emissive = Math.max(0, Number(v))) },
  { key: "rough", label: "Roughness", type: "num", step: 0.1, get: (o) => o.rough ?? 0.6, set: (o, v) => (o.rough = clamp(Number(v), 0, 1)) },
  { key: "checker", label: "Checker pattern", type: "check", get: (o) => !!o.checker, set: (o, v) => (o.checker = !!v) },
  { key: "body", label: "Physics", type: "select", opts: ["static", "dynamic", "trigger", "none"], get: (o) => o.body ?? "static", set: (o, v) => (o.body = v            ) },
  { key: "mass", label: "Mass", type: "num", step: 0.5, get: (o) => o.mass ?? 1, set: (o, v) => (o.mass = Math.max(0.01, Number(v))), show: (o) => o.body === "dynamic" },
  { key: "bounce", label: "Bounce", type: "num", step: 0.1, get: (o) => o.bounce ?? 0.1, set: (o, v) => (o.bounce = clamp(Number(v), 0, 1)), show: (o) => o.body === "dynamic" },
  { key: "script", label: "Script", type: "select", opts: [], get: (o) => o.script ?? "(none)", set: (o, v) => (o.script = v === "(none)" ? undefined : String(v)) },
  { key: "tag", label: "Tag", type: "text", get: (o) => o.tag ?? "", set: (o, v) => (o.tag = String(v) || undefined) },
  { key: "light", label: "Point light", type: "check", get: (o) => !!o.light, set: (o, v) => (o.light = v ? { color: [3, 2.2, 1.4], radius: 8 } : undefined) },
  { key: "lcolor", label: "Light color", type: "color", get: (o) => hex(o.light .color.map((x) => x / 3)        ), set: (o, v) => (o.light .color = unhex(String(v)).map((x) => x * 3)        ), show: (o) => !!o.light },
  { key: "lrad", label: "Light radius", type: "num", step: 1, get: (o) => o.light .radius, set: (o, v) => (o.light .radius = Math.max(0.5, Number(v))), show: (o) => !!o.light },
];

function fillInspector() {
  if (selected < 0 || !scene.objects[selected]) {
    insp.innerHTML = `<p class="hint">Select an object in the viewport or the list.</p>`;
    return;
  }
  const o = scene.objects[selected];
  const active = document.activeElement                           ;
  // don't rebuild while the user is typing in a field: just update the others
  if (active && insp.contains(active)) {
    insp.querySelectorAll                  ("[data-k]").forEach((el) => {
      if (el === active) return;
      const f = FIELDS.find((f) => f.key === el.dataset.k) ;
      const v = f.get(o);
      if (f.type === "vec3") el.value = String((v        )[Number(el.dataset.i)]);
    });
    return;
  }
  insp.innerHTML = "";
  for (const f of FIELDS) {
    if (f.show && !f.show(o)) continue;
    const row = document.createElement("label");
    row.className = "row";
    row.innerHTML = `<span>${f.label}</span>`;
    const commit = (v         ) => { checkpoint(); f.set(o, v); persist(); renderList(); if (["body", "light", "mesh"].includes(f.key)) fillInspector(); };
    if (f.type === "vec3") {
      const box = document.createElement("div");
      box.className = "vec";
      (f.get(o)        ).forEach((val, i) => {
        const inp = document.createElement("input");
        inp.type = "number"; inp.step = String(f.step); inp.value = String(val);
        inp.dataset.k = f.key; inp.dataset.i = String(i);
        inp.onchange = () => { const v = [...(f.get(o)        )]        ; v[i] = Number(inp.value); commit(v); };
        box.appendChild(inp);
      });
      row.appendChild(box);
    } else if (f.type === "select") {
      const sel = document.createElement("select");
      const opts = f.key === "script" ? ["(none)", ...Object.keys(scene.scripts ?? {})] : f.opts ;
      for (const op of opts) sel.add(new Option(op, op));
      sel.value = String(f.get(o));
      sel.onchange = () => commit(sel.value);
      row.appendChild(sel);
    } else {
      const inp = document.createElement("input");
      inp.type = f.type === "num" ? "number" : f.type === "check" ? "checkbox" : f.type;
      if (f.type === "check") inp.checked = Boolean(f.get(o)); else inp.value = String(f.get(o));
      if (f.step) inp.step = String(f.step);
      inp.dataset.k = f.key;
      inp.onchange = () => commit(f.type === "check" ? inp.checked : inp.value);
      row.appendChild(inp);
    }
    insp.appendChild(row);
  }
}

function refresh() { renderList(); fillInspector(); persist(); }

function add(kind        ) {
  if (playing) return;
  checkpoint();
  const p       = [snapTo(orbit.target[0]), 3, snapTo(orbit.target[2])];
  const base                              = {
    box: { name: "box", mesh: "box", pos: p, size: [1, 1, 1], color: [0.7, 0.7, 0.72], body: "static" },
    crate: { name: "crate", mesh: "box", pos: p, size: [1, 1, 1], color: [0.7, 0.48, 0.28], body: "dynamic", mass: 2 },
    sphere: { name: "ball", mesh: "sphere", pos: p, size: [1, 1, 1], color: [0.3, 0.5, 0.85], body: "dynamic", mass: 1, bounce: 0.5, rough: 0.25 },
    cylinder: { name: "pillar", mesh: "cylinder", pos: [p[0], 1.5, p[2]], size: [0.8, 3, 0.8], color: [0.35, 0.36, 0.4], body: "static" },
    gem: { name: "crystal", mesh: "gem", pos: p, size: [0.9, 1.3, 0.9], color: [0.4, 0.9, 1], emissive: 2.2, body: "trigger", tag: "coin" },
    light: { name: "lamp", mesh: "sphere", pos: p, size: [0.4, 0.4, 0.4], color: [1, 0.75, 0.4], emissive: 3, body: "none", light: { color: [3, 2, 1], radius: 8 } },
  };
  const o = structuredClone(base[kind]);
  let n = 1;
  while (scene.objects.some((x) => x.name === (n === 1 ? o.name : `${o.name} ${n}`))) n++;
  if (n > 1) o.name = `${o.name} ${n}`;
  scene.objects.push(o);
  selected = scene.objects.length - 1;
  refresh();
}

function duplicate() {
  if (selected < 0 || playing) return;
  checkpoint();
  const o = structuredClone(scene.objects[selected]);
  o.name += " copy";
  o.pos = [o.pos[0] + 1, o.pos[1], o.pos[2] + 1];
  scene.objects.push(o);
  selected = scene.objects.length - 1;
  refresh();
}

function remove() {
  if (selected < 0 || playing) return;
  checkpoint();
  scene.objects.splice(selected, 1);
  selected = -1;
  refresh();
}

// ---- play mode -------------------------------------------------------------------
function play() {
  if (playing) { stop(); return; }
  const world = new World(), phys = new PhysicsWorld();
  R.lights = [];
  spawnScene(scene, world, phys, R, eng.meshes);
  const rt = new ScriptRuntime(world, phys, R, eng.meshes, scene.scripts ?? {}, eng.input, eng.sfx, eng.camera);
  rt.attachAll();
  playing = { world, phys, snapshot: JSON.stringify(scene), rt };
  $("console").textContent = "";
  document.body.classList.add("playing");
  $("play").textContent = "Stop";
}
function stop() {
  if (!playing) return;
  scene = JSON.parse(playing.snapshot);
  playing = null;
  document.body.classList.remove("playing");
  $("play").textContent = "Play";
  refresh();
}

// ---- scripts tab + tabs ----------------------------------------------------------------
const scriptsTab = setupScriptsTab({
  getScene: () => scene,
  getSelected: () => selected,
  persist, checkpoint,
  afterChange: () => { refresh(); },
});
let sprites                                             = null;
function setTab(t        ) {
  document.body.dataset.tab = t;
  document.querySelectorAll                   ("[data-tabbtn]").forEach((b) => b.classList.toggle("on", b.dataset.tabbtn === t));
  if (t === "sprites") { sprites ??= initSpriteEditor(); sprites.renderAll(); }
  if (t === "scripts") scriptsTab.render();
}
document.querySelectorAll                   ("[data-tabbtn]").forEach((b) => (b.onclick = () => setTab(b.dataset.tabbtn )));

// ---- toolbar ----------------------------------------------------------------------
document.querySelectorAll                   ("[data-add]").forEach((b) => (b.onclick = () => add(b.dataset.add )));
$("play").onclick = play;
$("dup").onclick = duplicate;
$("del").onclick = remove;
$("undo").onclick = () => { if (undo.length) { redo.push(JSON.stringify(scene)); restore(undo.pop() ); } };
$("redo").onclick = () => { if (redo.length) { undo.push(JSON.stringify(scene)); restore(redo.pop() ); } };
$                  ("snap").onchange = (e) => (snap = (e.target                    ).checked);
$("new").onclick = () => { if (!confirm("Start a new scene? Unsaved changes are lost.")) return; checkpoint(); scene = structuredClone(DEFAULT); selected = -1; refresh(); };
$("save").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(scene, null, 2)], { type: "application/json" }));
  a.download = (scene.name || "scene") + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
};
$                  ("file").onchange = async (e) => {
  const f = (e.target                    ).files?.[0];
  if (!f) return;
  try {
    const s = JSON.parse(await f.text())         ;
    if (!Array.isArray(s.objects)) throw new Error("no objects array");
    checkpoint(); scene = s; selected = -1; refresh();
  } catch (err) { alert("Not an ember scene: " + (err         ).message); }
};
$("open").onclick = () => $                  ("file").click();

addEventListener("keydown", (e) => {
  const typing = (e.target               ).closest("input,select,textarea");
  if (e.ctrlKey && e.code === "KeyP") { play(); e.preventDefault(); return; }
  if (typing || document.body.dataset.tab !== "scene" || playing) return; // keys belong to the game while playing
  else if (e.code === "Delete" || e.code === "Backspace") remove();
  else if (e.ctrlKey && e.code === "KeyD") { duplicate(); e.preventDefault(); }
  else if (e.ctrlKey && e.code === "KeyZ") { $("undo").click(); e.preventDefault(); }
  else if (e.ctrlKey && e.code === "KeyY") { $("redo").click(); e.preventDefault(); }
  else if (e.code === "KeyF" && selected >= 0) orbit.target = [...scene.objects[selected].pos]        ;
  else if (selected >= 0 && !playing && e.code.startsWith("Arrow")) {
    checkpoint();
    const o = scene.objects[selected], s = snap ? 0.5 : 0.1;
    // nudge relative to the camera so "up" always moves away from the viewer
    const f       = normalize([-Math.sin(orbit.yaw), 0, -Math.cos(orbit.yaw)]), r       = [-f[2], 0, f[0]];
    const ax = Math.abs(f[0]) > Math.abs(f[2]) ? 0 : 2, rx = ax === 0 ? 2 : 0;
    if (e.code === "ArrowUp") o.pos[ax] += Math.sign(f[ax]) * s;
    if (e.code === "ArrowDown") o.pos[ax] -= Math.sign(f[ax]) * s;
    if (e.code === "ArrowRight") o.pos[rx] += Math.sign(r[rx]) * s;
    if (e.code === "ArrowLeft") o.pos[rx] -= Math.sign(r[rx]) * s;
    e.preventDefault();
    refresh();
  }
});

// ---- frame ---------------------------------------------------------------------------
const model = new Float32Array(16);
const OUTLINE       = [1, 0.78, 0.2];

function drawOutline(o             ) {
  // 12 thin emissive bars along the object's bounding box edges
  const h       = [o.size[0] / 2, o.size[1] / 2, o.size[2] / 2], t = 0.035 + 0.004 * orbit.dist * 0.2;
  const q = quatFromEuler(o.yaw ?? 0);
  const rot = (v      )       => { const c = Math.cos(o.yaw ?? 0), s = Math.sin(o.yaw ?? 0); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; };
  for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
    const edges                 = [
      [[0, sa * h[1], sb * h[2]], [o.size[0] + t, t, t]],
      [[sa * h[0], 0, sb * h[2]], [t, o.size[1] + t, t]],
      [[sa * h[0], sb * h[1], 0], [t, t, o.size[2] + t]],
    ];
    for (const [off, sz] of edges) {
      const p = rot(off);
      fromTRS([o.pos[0] + p[0], o.pos[1] + p[1], o.pos[2] + p[2]], q, sz, model);
      R.draw(eng.meshes.box, model, OUTLINE, { emissive: 2.5, shadow: false });
    }
  }
}

eng.run({
  fixedUpdate(dt) {
    if (!playing) return;
    savePrevious(playing.world);
    playing.rt.printed.length = 0;
    playing.rt.update(dt);
    const contacts = playing.phys.step(dt);
    playing.rt.dispatch(contacts);
    playing.world.flush();
  },
  update(dt) {
    const fol = playing?.rt.follow;
    if (fol && fol.obj.alive) {
      // third-person follow: keep the orbit angle the user set, chase the target
      const p = fol.obj.position, k = damp(10, dt);
      orbit.target = [lerp(orbit.target[0], p[0], k), lerp(orbit.target[1], p[1] + 1, k), lerp(orbit.target[2], p[2], k)];
      orbit.dist = fol.distance;
      if (eng.input.held("KeyQ")) orbit.yaw += 2 * dt;
      if (eng.input.held("KeyE")) orbit.yaw -= 2 * dt;
    }
    applyCamera();
    if (playing) scriptsTab.showConsole(playing.rt);
    if (!playing) {
      R.lights = scene.objects.filter((o) => o.light).map((o) => ({ pos: o.pos, color: o.light .color, radius: o.light .radius }));
      R.fogDensity = scene.fog ?? 0.0065;
    }
  },
  draw3d(alpha) {
    if (playing) { syncAndDraw(playing.world, R, alpha, model); return; }
    for (const o of scene.objects) {
      fromTRS(o.pos, quatFromEuler(o.yaw ?? 0), o.mesh === "plane" ? [o.size[0], 1, o.size[2]] : o.size, model);
      R.draw(eng.meshes[o.mesh], model, o.color, { emissive: o.emissive ?? 0, rough: o.rough, checker: o.checker, shadow: !(o.emissive ?? 0) });
    }
    if (selected >= 0 && scene.objects[selected]) drawOutline(scene.objects[selected]);
  },
  draw2d(sb, w, h) {
    if (playing) playing.rt.printed.forEach((t, i) => sb.text(t, 16, 16 + i * 26, 20, 0xffffffff));
    sb.text(playing ? "Playing. Ctrl+P or Stop returns to the saved layout." : `${scene.objects.length} objects`, 14, h - 30, 14, 0xffffffcc);
    sb.text(`${eng.fps.toFixed(0)} fps`, w - 14, h - 30, 14, 0xffffff99, 1);
  },
});

setTab("scene");
refresh();
(window                                  ).editor = { get scene() { return scene; }, select, add, play, pick, setTab, get playing() { return playing; } };
