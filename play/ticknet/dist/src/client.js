/**
 * Client-side netcode, transport-agnostic and browser-safe:
 *   - prediction:      apply local input immediately
 *   - reconciliation:  on each snapshot, rewind to the server's authoritative
 *                      state and replay every input it hasn't acknowledged
 *   - interpolation:   draw remote players `interpDelayMs` in the past,
 *                      between the two buffered snapshots that bracket it
 * `mode: "raw"` disables the first two (render exactly what the server says),
 * which is what the side-by-side demo compares against.
 */
import { applyInput, DT,                              } from "./sim.js";
                                                                    

                                       

                                                                                 

export class ClientCore {
  id = 0;
  mode      ;
  seq = 0;
  /** our authoritative-or-predicted position */
  me              = { x: 0, y: 0 };
  /** previous predicted position, for smoothing between ticks */
  prevMe              = { x: 0, y: 0 };
  pending          = [];
          buf             = [];
  interpDelayMs        ;
  redundancy        ;
  lastSnapTick = 0;
  synced = false;
  stats = { snapshots: 0, outOfOrder: 0, corrections: 0, maxCorrection: 0, lastCorrection: 0, replayed: 0 };
  rttMs = 0;

  constructor(mode       = "predicted", interpDelayMs = 100, redundancy = 4) {
    this.mode = mode;
    this.interpDelayMs = interpDelayMs;
    this.redundancy = redundancy;
  }

  /** Called once per client tick with the current controls. Returns the message to send. */
  tickInput(dx        , dy        )            {
    const inp        = { seq: ++this.seq, dx, dy };
    this.pending.push(inp);
    if (this.mode === "predicted") {
      this.prevMe = this.me;
      this.me = applyInput(this.me, inp, DT);
    }
    // send the newest input plus up to `redundancy - 1` older unacked ones
    return { t: "input", inputs: this.pending.slice(-this.redundancy) };
  }

  /** Handle a server message received at local time `now` (ms). */
  onMessage(m           , now        )       {
    if (m.t === "hello") {
      this.id = m.id;
      return;
    }
    if (m.t === "pong") {
      const rtt = now - m.c;
      this.rttMs = this.rttMs ? this.rttMs * 0.8 + rtt * 0.2 : rtt;
      return;
    }
    this.onSnapshot(m, now);
  }

          onSnapshot(s          , now        )       {
    this.stats.snapshots++;
    if (!this.id) this.id = s.you;      // hello was lost: every snapshot names its recipient
    if (s.tick <= this.lastSnapTick) { this.stats.outOfOrder++; return; }  // stale (reordered) snapshot
    this.lastSnapTick = s.tick;
    const players = new Map                     ();
    for (const p of s.players) players.set(p.id, { x: p.x, y: p.y });
    this.buf.push({ t: now, tick: s.tick, players });
    while (this.buf.length > 64) this.buf.shift();

    const mine = players.get(this.id);
    if (!mine) return;
    this.pending = this.pending.filter((i) => i.seq > s.ack);
    if (this.mode === "raw") {
      this.prevMe = this.me;
      this.me = mine;
      return;
    }
    // reconciliation: authoritative state + replay of everything not yet acked
    let st              = { ...mine };
    for (const inp of this.pending) st = applyInput(st, inp, DT);
    this.stats.replayed += this.pending.length;
    if (!this.synced) {          // first snapshot: adopt the spawn point, not a "correction"
      this.synced = true;
      this.prevMe = st;
      this.me = st;
      return;
    }
    const err = Math.hypot(st.x - this.me.x, st.y - this.me.y);
    this.stats.lastCorrection = err;
    if (err > 0.01) {
      this.stats.corrections++;
      this.stats.maxCorrection = Math.max(this.stats.maxCorrection, err);
    }
    this.prevMe = { x: this.prevMe.x + (st.x - this.me.x), y: this.prevMe.y + (st.y - this.me.y) };
    this.me = st;
  }

  /**
   * Remote players at render time `now`: interpolated between the snapshots
   * bracketing `now - interpDelayMs`. Raw mode shows the latest snapshot.
   */
  remotes(now        )                           {
    const out = new Map                     ();
    if (!this.buf.length) return out;
    if (this.mode === "raw" || this.interpDelayMs <= 0) {
      for (const [id, p] of this.buf[this.buf.length - 1].players) if (id !== this.id) out.set(id, p);
      return out;
    }
    const target = now - this.interpDelayMs;
    let i = this.buf.length - 1;
    while (i > 0 && this.buf[i - 1].t > target) i--;
    const b = this.buf[i], a = this.buf[Math.max(0, i - 1)];
    if (target >= b.t || a === b) {
      // buffer ran dry (late packets): hold the newest state, don't extrapolate
      for (const [id, p] of b.players) if (id !== this.id) out.set(id, p);
      return out;
    }
    const f = Math.max(0, Math.min(1, (target - a.t) / (b.t - a.t)));
    for (const [id, pb] of b.players) {
      if (id === this.id) continue;
      const pa = a.players.get(id) ?? pb;
      out.set(id, { x: pa.x + (pb.x - pa.x) * f, y: pa.y + (pb.y - pa.y) * f });
    }
    return out;
  }

  /** Own position for drawing, smoothed between client ticks (alpha in [0,1]). */
  render(alpha        )              {
    return { x: this.prevMe.x + (this.me.x - this.prevMe.x) * alpha, y: this.prevMe.y + (this.me.y - this.prevMe.y) * alpha };
  }
}
