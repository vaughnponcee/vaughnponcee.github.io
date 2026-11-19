/**
 * Browser test client: two independent connections driven by the same keys.
 * Left = raw (draw what the server says). Right = predicted + reconciled +
 * interpolated. Both go through the same simulated link (applied here, on
 * send and on receive), so the server sees the real delayed traffic.
 */
import { ClientCore,           } from "../src/client.js";
import { Link, PRESETS,                 } from "../src/linksim.js";
import { decodeServer, encode,                } from "../src/protocol.js";
import { ARENA, RADIUS, TICK_HZ } from "../src/sim.js";
import { connectLocal,                 } from "./local.js";

// served by bin/server.ts: use its WebSocket. Anywhere else (static hosting): run the server in the page.
const LOCAL = new URLSearchParams(location.search).has("local") || !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(location.host);

                 
             
                   
                             
                   
                     
                            
                                
                    
                                            
                                    
 

const cfg             = { ...PRESETS.bad };
const autopilot = new URLSearchParams(location.search).has("autopilot");
const keys = new Set        ();
addEventListener("keydown", (e) => { keys.add(e.code); if (e.code.startsWith("Arrow")) e.preventDefault(); });
addEventListener("keyup", (e) => keys.delete(e.code));

function makePanel(mode      , el        , seed        )        {
  const canvas = document.getElementById(el)                     ;
  canvas.width = ARENA.w;
  canvas.height = ARENA.h;
  const core = new ClientCore(mode, 100);
  const ws                         = LOCAL ? connectLocal() : new WebSocket(`ws://${location.host}/ws`);
  const p        = {
    mode, core, ws, up: new Link(cfg, seed), down: new Link(cfg, seed + 99), canvas,
    ctx: canvas.getContext("2d")                            ,
    info: document.getElementById(el + "-info")               , serverMe: null, trail: [],
  };
  ws.onmessage = (ev                   ) => p.down.send(performance.now(), ev.data          );
  return p;
}

const panels = [makePanel("raw", "raw", 11), makePanel("predicted", "pred", 22)];

function applyCfg(c            )       {
  Object.assign(cfg, c);
  for (const p of panels) { p.up.cfg = { ...cfg }; p.down.cfg = { ...cfg }; }
  (document.getElementById("lat")                    ).value = String(cfg.latencyMs);
  (document.getElementById("jit")                    ).value = String(cfg.jitterMs);
  (document.getElementById("loss")                    ).value = String(Math.round(cfg.loss * 100));
  (document.getElementById("cfg")               ).textContent =
    `one-way ${cfg.latencyMs}-${cfg.latencyMs + cfg.jitterMs} ms, loss ${(cfg.loss * 100).toFixed(0)}%`;
}
for (const name of Object.keys(PRESETS)) {
  document.getElementById("p-" + name)?.addEventListener("click", () => applyCfg(PRESETS[name]));
}
for (const [id, key, scale] of [["lat", "latencyMs", 1], ["jit", "jitterMs", 1], ["loss", "loss", 0.01]]         ) {
  document.getElementById(id)?.addEventListener("input", (e) =>
    applyCfg({ ...cfg, [key]: Number((e.target                    ).value) * scale }));
}
applyCfg(cfg);

let nextTick = performance.now();
let lastPing = 0;
const tickMs = 1000 / TICK_HZ;

/**
 * Networking + input run on a timer, not on requestAnimationFrame: rAF is
 * paused in background tabs (and in headless browsers), and the client must
 * keep sending inputs and draining packets regardless of whether it draws.
 */
function netLoop()       {
  const now = performance.now();
  // deliver delayed traffic
  for (const p of panels) {
    for (const raw of p.down.receive(now)) {
      const m = decodeServer(raw)             ;
      if (m.t === "snap") p.serverMe = m.players.find((q) => q.id === m.you) ?? null;
      p.core.onMessage(m, now);
    }
    for (const raw of p.up.receive(now)) if (p.ws.readyState === 1) p.ws.send(raw);
  }
  // fixed-rate input
  while (now >= nextTick) {
    let dx = (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0);
    let dy = (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0) - (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0);
    if (autopilot && !dx && !dy) {          // ?autopilot: drive a figure-eight hands-free
      const t = now / 1000;
      dx = Math.cos(t * 1.3);
      dy = Math.sin(t * 2.6);
    }
    // inputs flow from the first tick: the server queues them even before we know our id
    for (const p of panels) if (p.ws.readyState === 1) p.up.send(now, encode(p.core.tickInput(dx, dy)));
    nextTick += tickMs;
  }
  if (now - lastPing > 1000) {
    lastPing = now;
    for (const p of panels) if (p.core.id) p.up.send(now, encode({ t: "ping", c: now }));
  }
  if (now - lastDraw > 100) render(now);   // rAF stalled (hidden tab / headless): draw anyway
}

let lastDraw = 0;
function render(now        )       {
  lastDraw = now;
  const alpha = 1 - (nextTick - now) / tickMs;
  for (const p of panels) draw(p, now, alpha);
}

function frame()       {
  netLoop();
  render(performance.now());
  requestAnimationFrame(frame);
}
setInterval(netLoop, 4);

function circle(ctx                          , x        , y        , r        , fill               , stroke               ) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
}

function draw(p       , now        , alpha        )       {
  const ctx = p.ctx;
  ctx.fillStyle = "#0e1013";
  ctx.fillRect(0, 0, ARENA.w, ARENA.h);
  ctx.strokeStyle = "#1c2027";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= ARENA.w; x += 50) { ctx.moveTo(x, 0); ctx.lineTo(x, ARENA.h); }
  for (let y = 0; y <= ARENA.h; y += 50) { ctx.moveTo(0, y); ctx.lineTo(ARENA.w, y); }
  ctx.stroke();
  for (const [, r] of p.core.remotes(now)) circle(ctx, r.x, r.y, RADIUS, "#5b6573", null);
  const me = p.core.render(p.mode === "predicted" ? Math.min(1, Math.max(0, alpha)) : 1);
  p.trail.push(me);
  if (p.trail.length > 40) p.trail.shift();
  ctx.strokeStyle = "rgba(240,180,80,0.35)";
  ctx.beginPath();
  p.trail.forEach((t, i) => (i ? ctx.lineTo(t.x, t.y) : ctx.moveTo(t.x, t.y)));
  ctx.stroke();
  if (p.mode === "predicted" && p.serverMe) circle(ctx, p.serverMe.x, p.serverMe.y, RADIUS, null, "rgba(255,255,255,0.35)");
  circle(ctx, me.x, me.y, RADIUS, p.mode === "raw" ? "#e07a5f" : "#81b29a", null);
  const s = p.core.stats;
  p.info.textContent = `id ${p.core.id}   rtt ${p.core.rttMs.toFixed(0)} ms   unacked inputs ${p.core.pending.length}   ` +
    `snapshots ${s.snapshots} (stale ${s.outOfOrder})   corrections ${s.corrections} (max ${s.maxCorrection.toFixed(1)} px)`;
}

requestAnimationFrame(frame);
