/**
 * Sprite painter and animator for the ember editor.
 *
 * Draw pixel art frame by frame, see the previous frame faintly (onion skin),
 * define named animations over frame ranges, preview them live, and save to
 * the asset library. Games load the result with loadSprite() + Animator.
 *
 * Keys (while the Sprites tab is open): B pencil, E eraser, G fill, I picker,
 * M mirror, O onion skin, [ ] previous/next frame, N new frame, Ctrl+Z / Ctrl+Y.
 */
import { icon } from "./icons.js";
import {                                    Library, blankFrame, decodePixels, encodePixels, sheetCanvas } from "../src/assets.js";

                                                    
const PALETTE = ["#000000", "#1d1d24", "#3a3f4a", "#6e7078", "#a6aab4", "#ffffff", "#e34b4b", "#f08a4b", "#f2c14e", "#ffe08a",
  "#6cc46a", "#3e8a3d", "#4b8be3", "#2f3b66", "#9b5de5", "#f0c8a0", "#b07a45", "#6b4a32"];

export function initSpriteEditor() {
  const $ =                        (id        ) => document.getElementById(id)     ;
  const cv = $                   ("paint"), g = cv.getContext("2d") ;
  const prev = $                   ("preview"), pg = prev.getContext("2d") ;
  const strip = $("frames"), animList = $("anims"), lib = $("library");

  let asset              = Library.all()[0] ?? newAsset("hero", 16, 16);
  let frame = 0, tool       = "pencil", color = "#e34b4b", mirror = false, onion = true;
  let pixels = decodePixels(asset.frames[0], asset.w, asset.h);
  const undo           = [], redo           = [];
  let previewAnim = 0, previewT = 0;
  // timeline playback: shows every frame in order on the big canvas
  let playing = false, playT = 0, shown = -1;

  function newAsset(name        , w        , h        )              {
    return { kind: "sprite", name, w, h, frames: [blankFrame(w, h)], anims: [{ name: "idle", from: 0, to: 0, fps: 8, loop: true }] };
  }

  const scale = () => Math.floor(Math.min(cv.clientWidth, cv.clientHeight) / Math.max(asset.w, asset.h)) || 1;

  function commitFrame() {
    asset.frames[frame] = encodePixels(pixels);
    Library.save(asset);
  }
  function snapshot() {
    undo.push(JSON.stringify({ frames: asset.frames, frame, anims: asset.anims }));
    if (undo.length > 100) undo.shift();
    redo.length = 0;
  }
  function restore(s        ) {
    const o = JSON.parse(s);
    asset.frames = o.frames; asset.anims = o.anims; frame = Math.min(o.frame, asset.frames.length - 1);
    pixels = decodePixels(asset.frames[frame], asset.w, asset.h);
    Library.save(asset);
    renderAll();
  }

  // ---- painting ---------------------------------------------------------------
  function draw() {
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const s = scale(), ox = Math.floor((W - asset.w * s) / 2), oy = Math.floor((H - asset.h * s) / 2);
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, W, H);
    // transparency checkerboard
    for (let y = 0; y < asset.h; y++) for (let x = 0; x < asset.w; x++) {
      g.fillStyle = (x + y) % 2 ? "#2a2c31" : "#33363c";
      g.fillRect(ox + x * s, oy + y * s, s, s);
    }
    const blit = (px                   , alpha        ) => {
      const t = document.createElement("canvas");
      t.width = asset.w; t.height = asset.h;
      t.getContext("2d") .putImageData(new ImageData(new Uint8ClampedArray(px), asset.w, asset.h), 0, 0);
      g.globalAlpha = alpha;
      g.drawImage(t, ox, oy, asset.w * s, asset.h * s);
      g.globalAlpha = 1;
    };
    if (playing && shown >= 0) {
      blit(shown === frame ? pixels : decodePixels(asset.frames[shown], asset.w, asset.h), 1);
    } else {
      if (onion && frame > 0) blit(decodePixels(asset.frames[frame - 1], asset.w, asset.h), 0.28);
      blit(pixels, 1);
    }
    if (s >= 6) {
      g.strokeStyle = "#ffffff14";
      g.beginPath();
      for (let x = 0; x <= asset.w; x++) { g.moveTo(ox + x * s + 0.5, oy); g.lineTo(ox + x * s + 0.5, oy + asset.h * s); }
      for (let y = 0; y <= asset.h; y++) { g.moveTo(ox, oy + y * s + 0.5); g.lineTo(ox + asset.w * s, oy + y * s + 0.5); }
      g.stroke();
    }
    if (mirror) { g.strokeStyle = "#f2c14e88"; g.beginPath(); g.moveTo(ox + (asset.w * s) / 2, oy); g.lineTo(ox + (asset.w * s) / 2, oy + asset.h * s); g.stroke(); }
    return { s, ox, oy };
  }

  const rgba = (h        ) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];
  function setPx(x        , y        , c          ) {
    if (x < 0 || y < 0 || x >= asset.w || y >= asset.h) return;
    const i = (y * asset.w + x) * 4;
    pixels[i] = c[0]; pixels[i + 1] = c[1]; pixels[i + 2] = c[2]; pixels[i + 3] = c[3];
  }
  function paintAt(x        , y        ) {
    const c = tool === "eraser" ? [0, 0, 0, 0] : rgba(color);
    setPx(x, y, c);
    if (mirror) setPx(asset.w - 1 - x, y, c);
  }
  function fill(x        , y        ) {
    const i0 = (y * asset.w + x) * 4, target = [...pixels.slice(i0, i0 + 4)], c = rgba(color);
    if (target.every((v, k) => v === c[k])) return;
    const stack = [[x, y]];
    while (stack.length) {
      const [px, py] = stack.pop() ;
      if (px < 0 || py < 0 || px >= asset.w || py >= asset.h) continue;
      const i = (py * asset.w + px) * 4;
      if (pixels[i] !== target[0] || pixels[i + 1] !== target[1] || pixels[i + 2] !== target[2] || pixels[i + 3] !== target[3]) continue;
      setPx(px, py, c);
      stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
    }
  }

  let painting = false, last                          = null;
  const cell = (e              )                   => {
    const { s, ox, oy } = draw(), r = cv.getBoundingClientRect();
    return [Math.floor((e.clientX - r.left - ox) / s), Math.floor((e.clientY - r.top - oy) / s)];
  };
  cv.addEventListener("pointerdown", (e) => {
    if (playing) togglePlay(); // clicking the canvas stops playback so you can draw
    const [x, y] = cell(e);
    if (x < 0 || y < 0 || x >= asset.w || y >= asset.h) return;
    if (tool === "picker" || e.button === 2) {
      const i = (y * asset.w + x) * 4;
      if (pixels[i + 3]) setColor("#" + [0, 1, 2].map((k) => pixels[i + k].toString(16).padStart(2, "0")).join(""));
      return;
    }
    snapshot();
    if (tool === "fill") { fill(x, y); commitFrame(); renderAll(); return; }
    painting = true; last = [x, y];
    cv.setPointerCapture(e.pointerId);
    paintAt(x, y);
    draw();
  });
  cv.addEventListener("pointermove", (e) => {
    if (!painting || !last) return;
    const [x, y] = cell(e);
    // line from the last cell so fast strokes don't leave gaps
    const n = Math.max(Math.abs(x - last[0]), Math.abs(y - last[1]));
    for (let k = 1; k <= n; k++) paintAt(Math.round(last[0] + ((x - last[0]) * k) / n), Math.round(last[1] + ((y - last[1]) * k) / n));
    last = [x, y];
    draw();
  });
  const endStroke = () => { if (painting) { painting = false; commitFrame(); renderFrames(); } };
  cv.addEventListener("pointerup", endStroke);
  cv.addEventListener("pointercancel", endStroke);
  cv.addEventListener("contextmenu", (e) => e.preventDefault());

  // ---- tools & palette ---------------------------------------------------------
  function setTool(t      ) {
    tool = t;
    document.querySelectorAll                   ("[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === t));
  }
  function setColor(c        ) {
    color = c;
    $                  ("color").value = c;
    document.querySelectorAll             (".swatch").forEach((s) => s.classList.toggle("on", s.dataset.c === c));
    if (tool === "eraser" || tool === "picker") setTool("pencil");
  }
  document.querySelectorAll                   ("[data-tool]").forEach((b) => (b.onclick = () => setTool(b.dataset.tool        )));
  const pal = $("palette");
  for (const c of PALETTE) {
    const s = document.createElement("button");
    s.className = "swatch"; s.dataset.c = c; s.style.background = c; s.title = c;
    s.onclick = () => setColor(c);
    pal.appendChild(s);
  }
  $                  ("color").oninput = (e) => setColor((e.target                    ).value);
  const mirrorBox = $                  ("mirror"), onionBox = $                  ("onion");
  mirrorBox.onchange = () => { mirror = mirrorBox.checked; draw(); };
  onionBox.onchange = () => { onion = onionBox.checked; draw(); };

  // ---- frames ------------------------------------------------------------------
  function goto(i        ) {
    if (playing) togglePlay();
    commitFrame();
    frame = Math.max(0, Math.min(asset.frames.length - 1, i));
    pixels = decodePixels(asset.frames[frame], asset.w, asset.h);
    renderAll();
  }
  function renderFrames() {
    strip.innerHTML = "";
    asset.frames.forEach((f, i) => {
      const t = document.createElement("canvas");
      t.width = asset.w; t.height = asset.h;
      t.getContext("2d") .putImageData(new ImageData(i === frame ? new Uint8ClampedArray(pixels) : decodePixels(f, asset.w, asset.h), asset.w, asset.h), 0, 0);
      const b = document.createElement("button");
      b.className = "fr" + (i === frame ? " on" : "");
      b.title = `Frame ${i}`;
      b.appendChild(t);
      const n = document.createElement("span");
      n.textContent = String(i);
      b.appendChild(n);
      b.onclick = () => goto(i);
      strip.appendChild(b);
    });
    $("frameinfo").textContent = `Frame ${frame} of ${asset.frames.length - 1}`;
  }
  $("fr-add").onclick = () => { snapshot(); commitFrame(); asset.frames.splice(frame + 1, 0, blankFrame(asset.w, asset.h)); goto(frame + 1); };
  $("fr-dup").onclick = () => { snapshot(); commitFrame(); asset.frames.splice(frame + 1, 0, asset.frames[frame]); goto(frame + 1); };
  $("fr-del").onclick = () => {
    if (asset.frames.length < 2) return;
    snapshot(); asset.frames.splice(frame, 1);
    for (const a of asset.anims) { a.from = Math.min(a.from, asset.frames.length - 1); a.to = Math.min(a.to, asset.frames.length - 1); }
    frame = Math.min(frame, asset.frames.length - 1); pixels = decodePixels(asset.frames[frame], asset.w, asset.h); Library.save(asset); renderAll();
  };
  const move = (d        ) => {
    const j = frame + d;
    if (j < 0 || j >= asset.frames.length) return;
    snapshot(); commitFrame();
    [asset.frames[frame], asset.frames[j]] = [asset.frames[j], asset.frames[frame]];
    goto(j);
  };
  $("fr-left").onclick = () => move(-1);
  $("fr-right").onclick = () => move(1);
  $("fr-clear").onclick = () => { snapshot(); pixels.fill(0); commitFrame(); renderAll(); };
  $("fr-flip").onclick = () => {
    snapshot();
    const out = new Uint8ClampedArray(pixels.length);
    for (let y = 0; y < asset.h; y++) for (let x = 0; x < asset.w; x++) out.set(pixels.subarray((y * asset.w + x) * 4, (y * asset.w + x) * 4 + 4), (y * asset.w + asset.w - 1 - x) * 4);
    pixels = out; commitFrame(); renderAll();
  };

  // ---- timeline playback ----------------------------------------------------------
  const playBtn = $("tl-play"), fpsBox = $                  ("tl-fps");
  function togglePlay() {
    playing = !playing;
    playT = 0;
    shown = frame;
    document.body.classList.toggle("anim-playing", playing);
    playBtn.innerHTML = icon(playing ? "pause" : "play", 14);
    playBtn.title = playing ? "Pause (P)" : "Play animation (P)";
    if (!playing) { shown = -1; renderFrames(); draw(); }
  }
  playBtn.onclick = togglePlay;
  function highlight(i        ) {
    strip.querySelectorAll(".fr").forEach((el, k) => el.classList.toggle("on", k === i));
    $("frameinfo").textContent = `Frame ${i} of ${asset.frames.length - 1}`;
  }

  // ---- animations ----------------------------------------------------------------
  function renderAnims() {
    animList.innerHTML = "";
    asset.anims.forEach((a, i) => {
      const row = document.createElement("div");
      row.className = "anim" + (i === previewAnim ? " on" : "");
      row.innerHTML = `<input class="an" value=""><label>from<input type="number" class="af" min="0"></label><label>to<input type="number" class="at" min="0"></label><label>fps<input type="number" class="ap" min="1" max="60"></label><label class="lp"><input type="checkbox" class="al">loop</label><button class="ax" title="Delete animation">${icon("x", 14)}</button>`;
      const q =                             (c        ) => row.querySelector(c)     ;
      q(".an").value = a.name; q(".af").value = String(a.from); q(".at").value = String(a.to); q(".ap").value = String(a.fps); q(".al").checked = a.loop;
      const max = asset.frames.length - 1;
      const upd = () => {
        snapshot();
        a.name = q(".an").value || "anim";
        a.from = Math.max(0, Math.min(max, Number(q(".af").value)));
        a.to = Math.max(a.from, Math.min(max, Number(q(".at").value)));
        a.fps = Math.max(1, Math.min(60, Number(q(".ap").value)));
        a.loop = q(".al").checked;
        Library.save(asset);
      };
      row.querySelectorAll("input").forEach((el) => (el.onchange = upd));
      row.onclick = (e) => { if ((e.target               ).tagName !== "INPUT") { previewAnim = i; previewT = 0; renderAnims(); } };
      (row.querySelector(".ax")                     ).onclick = (e) => { e.stopPropagation(); snapshot(); asset.anims.splice(i, 1); previewAnim = 0; Library.save(asset); renderAnims(); };
      animList.appendChild(row);
    });
  }
  $("an-add").onclick = () => {
    snapshot();
    asset.anims.push({ name: `anim${asset.anims.length}`, from: 0, to: asset.frames.length - 1, fps: 8, loop: true });
    previewAnim = asset.anims.length - 1;
    Library.save(asset); renderAnims();
  };

  // ---- library ----------------------------------------------------------------------
  function renderLibrary() {
    lib.innerHTML = "";
    for (const a of Library.all()) {
      const li = document.createElement("li");
      li.className = a.name === asset.name ? "sel" : "";
      const t = document.createElement("canvas");
      t.width = a.w; t.height = a.h;
      t.getContext("2d") .putImageData(new ImageData(decodePixels(a.frames[0], a.w, a.h), a.w, a.h), 0, 0);
      li.appendChild(t);
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = a.name;
      li.appendChild(nm);
      const meta = document.createElement("span");
      meta.className = "kind";
      meta.textContent = `${a.w}x${a.h} · ${a.frames.length}f`;
      li.appendChild(meta);
      li.onclick = () => open(a.name);
      lib.appendChild(li);
    }
  }
  function open(name        ) {
    commitFrame();
    const a = Library.get(name);
    if (!a) return;
    asset = a; frame = 0; previewAnim = 0; undo.length = redo.length = 0;
    pixels = decodePixels(asset.frames[0], asset.w, asset.h);
    renderAll();
  }
  $("sp-new").onclick = () => {
    const name = prompt("Sprite name", "sprite" + (Library.all().length + 1));
    if (!name) return;
    const size = Number(prompt("Size in pixels (8 to 64)", "16")) || 16;
    const s = Math.max(4, Math.min(64, Math.round(size)));
    commitFrame();
    asset = newAsset(name.trim(), s, s);
    Library.save(asset);
    frame = 0; pixels = decodePixels(asset.frames[0], s, s); undo.length = redo.length = 0;
    renderAll();
  };
  $("sp-rename").onclick = () => {
    const name = prompt("New name", asset.name);
    if (!name || name === asset.name) return;
    Library.remove(asset.name); asset.name = name.trim(); Library.save(asset); renderAll();
  };
  $("sp-del").onclick = () => {
    if (!confirm(`Delete sprite "${asset.name}"?`)) return;
    Library.remove(asset.name);
    asset = Library.all()[0] ?? newAsset("hero", 16, 16);
    Library.save(asset);
    frame = 0; pixels = decodePixels(asset.frames[0], asset.w, asset.h);
    renderAll();
  };
  const download = (blob      , name        ) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
  };
  $("sp-png").onclick = () => { commitFrame(); sheetCanvas(asset).toBlob((b) => b && download(b, asset.name + ".png")); };
  $("sp-json").onclick = () => { commitFrame(); download(new Blob([JSON.stringify(asset)], { type: "application/json" }), asset.name + ".sprite.json"); };
  $                  ("sp-file").onchange = async (e) => {
    const f = (e.target                    ).files?.[0];
    if (!f) return;
    try {
      const a = JSON.parse(await f.text())               ;
      if (a.kind !== "sprite" || !a.frames?.length) throw new Error("missing frames");
      Library.save(a); open(a.name);
    } catch (err) { alert("Not an ember sprite: " + (err         ).message); }
  };
  $("sp-import").onclick = () => $                  ("sp-file").click();

  // ---- preview ---------------------------------------------------------------------------
  let lastT = performance.now();
  function tick(now        ) {
    const dt = (now - lastT) / 1000;
    lastT = now;
    if (document.body.dataset.tab === "sprites" && playing) {
      playT += dt;
      const fps = Math.max(1, Math.min(60, Number(fpsBox.value) || 8));
      const idx = Math.floor(playT * fps) % asset.frames.length;
      if (idx !== shown) { shown = idx; draw(); highlight(idx); }
    }
    if (document.body.dataset.tab === "sprites") {
      previewT += dt;
      const a             = asset.anims[previewAnim] ?? { name: "", from: 0, to: asset.frames.length - 1, fps: 8, loop: true };
      const n = Math.max(1, a.to - a.from + 1);
      let k = Math.floor(previewT * a.fps);
      k = a.loop ? k % n : Math.min(k, n - 1);
      const idx = Math.min(a.from + k, asset.frames.length - 1);
      const px = idx === frame ? pixels : decodePixels(asset.frames[idx], asset.w, asset.h);
      const t = document.createElement("canvas");
      t.width = asset.w; t.height = asset.h;
      t.getContext("2d") .putImageData(new ImageData(new Uint8ClampedArray(px), asset.w, asset.h), 0, 0);
      pg.imageSmoothingEnabled = false;
      pg.fillStyle = "#1b1d21";
      pg.fillRect(0, 0, prev.width, prev.height);
      const s = Math.floor(Math.min(prev.width, prev.height) / Math.max(asset.w, asset.h));
      pg.drawImage(t, (prev.width - asset.w * s) / 2, (prev.height - asset.h * s) / 2, asset.w * s, asset.h * s);
      $("previewinfo").textContent = `${a.name || "all"} · frame ${idx}`;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  addEventListener("keydown", (e) => {
    if (document.body.dataset.tab !== "sprites" || (e.target               ).closest("input,select,textarea")) return;
    const k = e.code;
    if (k === "KeyB") setTool("pencil");
    else if (k === "KeyE") setTool("eraser");
    else if (k === "KeyG") setTool("fill");
    else if (k === "KeyI") setTool("picker");
    else if (k === "KeyM") { mirrorBox.checked = mirror = !mirror; draw(); }
    else if (k === "KeyO") { onionBox.checked = onion = !onion; draw(); }
    else if (k === "BracketLeft") goto(frame - 1);
    else if (k === "BracketRight") goto(frame + 1);
    else if (k === "KeyN") $("fr-add").click();
    else if (k === "KeyP") togglePlay();
    else if (e.ctrlKey && k === "KeyZ") { if (undo.length) { redo.push(JSON.stringify({ frames: asset.frames, frame, anims: asset.anims })); restore(undo.pop() ); } e.preventDefault(); }
    else if (e.ctrlKey && k === "KeyY") { if (redo.length) { undo.push(JSON.stringify({ frames: asset.frames, frame, anims: asset.anims })); restore(redo.pop() ); } e.preventDefault(); }
  });
  addEventListener("resize", () => draw());

  function renderAll() {
    $("sp-name").textContent = `${asset.name} (${asset.w}x${asset.h})`;
    draw(); renderFrames(); renderAnims(); renderLibrary();
  }
  setTool("pencil");
  setColor(color);
  Library.save(asset);
  return { renderAll, get asset() { return asset; } };
}
