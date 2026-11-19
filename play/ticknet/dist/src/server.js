/**
 * Authoritative game server, transport-agnostic: feed it connections and
 * messages, call tick() at TICK_HZ, deliver what it returns.
 */
import { applyInput, spawnPoint,                              } from "./sim.js";
import { decodeClient,                } from "./protocol.js";

                  
             
                     
                                                                       
                                                 
               
                   
                                                                   
 

                                                        

/** Inputs applied per client per tick. One is the normal rate; a small
 *  surplus lets a client catch up after jitter bunches packets together,
 *  without letting it run faster than real time for long (speed hacks). */
export const MAX_INPUTS_PER_TICK = 3;
/** Inputs buffered per client; anything beyond is dropped as abuse. */
export const MAX_QUEUE = 32;

export class GameServer {
  tick = 0;
          clients = new Map                ();
          nextId = 1;
  stats = { inputsApplied: 0, duplicateInputs: 0, malformed: 0, queueOverflow: 0, gapWaits: 0, inputsSkipped: 0 };
  /** Ticks to wait for a missing input before skipping it (0 = never wait). */
  reorderWaitTicks        ;

  constructor(reorderWaitTicks = 3) {
    this.reorderWaitTicks = reorderWaitTicks;
  }

  connect(bot = false)                                   {
    const id = this.nextId++;
    this.clients.set(id, { id, state: spawnPoint(id), queue: [], lastSeq: 0, bot, rejected: 0, waited: 0 });
    return { id, hello: { t: "hello", id, tick: this.tick, tickHz: 30 } };
  }

  disconnect(id        )       {
    this.clients.delete(id);
  }

  get playerCount()         {
    return this.clients.size;
  }

  state(id        )                          {
    const c = this.clients.get(id);
    return c && { ...c.state };
  }

  lastAck(id        )         {
    return this.clients.get(id)?.lastSeq ?? 0;
  }

  /** Raw text from a client. Returns an immediate reply (pong) if any. */
  receive(id        , raw        , serverTimeMs = 0)                   {
    const c = this.clients.get(id);
    if (!c) return null;
    const m = decodeClient(raw);
    if (!m) { this.stats.malformed++; c.rejected++; return null; }
    if (m.t === "ping") return { t: "pong", c: m.c, s: serverTimeMs };
    for (const inp of m.inputs) {
      if (inp.seq <= c.lastSeq || c.queue.some((q) => q.seq === inp.seq)) { this.stats.duplicateInputs++; continue; }
      if (c.queue.length >= MAX_QUEUE) { this.stats.queueOverflow++; continue; }
      c.queue.push(inp);
    }
    c.queue.sort((a, b) => a.seq - b.seq);
    return null;
  }

  /** Advance one tick and produce snapshots for every connected client. */
  step(botInput                                      )             {
    this.tick++;
    for (const c of this.clients.values()) {
      if (c.bot && botInput) {
        const inp = botInput(c.id, this.tick);
        c.state = applyInput(c.state, inp);
        c.lastSeq = inp.seq;
        continue;
      }
      let n = 0;
      while (c.queue.length && n < MAX_INPUTS_PER_TICK) {
        const inp = c.queue[0];
        if (inp.seq !== c.lastSeq + 1 && c.waited < this.reorderWaitTicks) {
          // Gap: the missing input may still be in flight on a slower path.
          // Wait a few ticks before giving up on it (input jitter buffer).
          c.waited++;
          this.stats.gapWaits++;
          break;
        }
        if (inp.seq !== c.lastSeq + 1) this.stats.inputsSkipped += inp.seq - c.lastSeq - 1;
        c.queue.shift();
        c.waited = 0;
        c.state = applyInput(c.state, inp);
        c.lastSeq = inp.seq;
        this.stats.inputsApplied++;
        n++;
      }
    }
    const players = [...this.clients.values()].map((c) => ({ id: c.id, x: c.state.x, y: c.state.y }));
    const out             = [];
    for (const c of this.clients.values()) {
      if (!c.bot) out.push({ to: c.id, msg: { t: "snap", tick: this.tick, you: c.id, ack: c.lastSeq, players } });
    }
    return out;
  }
}

/** Bots wander along Lissajous curves so remote-entity interpolation has something to show. */
export function botInput(id        , tick        )        {
  const t = tick / 30;
  return { seq: tick, dx: Math.cos(t * (0.7 + id * 0.13) + id), dy: Math.sin(t * (0.9 + id * 0.07) + id * 2) };
}
