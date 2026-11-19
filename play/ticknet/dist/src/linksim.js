/**
 * Simulated bad network between two endpoints: one-way latency with uniform
 * jitter, random loss, and (as a consequence of jitter) reordering. Works on
 * any clock, so tests can run thousands of ticks in milliseconds.
 */
                             
                                                
                                                   
                                                   
                                                                     
 

export const PRESETS                             = {
  lan: { latencyMs: 2, jitterMs: 1, loss: 0 },
  good: { latencyMs: 25, jitterMs: 25, loss: 0 },
  // the "50-300 ms jitter" scenario: one-way 50..300 ms, RTT 100..600 ms
  bad: { latencyMs: 50, jitterMs: 250, loss: 0.05 },
  awful: { latencyMs: 150, jitterMs: 300, loss: 0.15, duplicate: 0.02 },
};

export function mulberry32(seed        )               {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

                                                         

export class Link    {
  cfg            ;
          rand              ;
          q                = [];
          n = 0;
  sent = 0;
  dropped = 0;
  delivered = 0;

  constructor(cfg            , seed = 1) {
    this.cfg = { ...cfg };
    this.rand = mulberry32(seed);
  }

  send(now        , msg   )       {
    this.sent++;
    if (this.rand() < this.cfg.loss) { this.dropped++; return; }
    const copies = this.cfg.duplicate && this.rand() < this.cfg.duplicate ? 2 : 1;
    for (let c = 0; c < copies; c++) {
      const delay = this.cfg.latencyMs + this.rand() * this.cfg.jitterMs;
      this.q.push({ at: now + delay, seq: this.n++, msg });
    }
  }

  /** Everything due at or before `now`, in arrival-time order (so jitter reorders). */
  receive(now        )      {
    if (!this.q.length) return [];
    const due                = [];
    const keep                = [];
    for (const p of this.q) (p.at <= now ? due : keep).push(p);
    this.q = keep;
    due.sort((a, b) => a.at - b.at || a.seq - b.seq);
    this.delivered += due.length;
    return due.map((p) => p.msg);
  }

  get inFlight()         {
    return this.q.length;
  }
}
