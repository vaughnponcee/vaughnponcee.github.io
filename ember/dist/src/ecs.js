/**
 * Entity component system with sparse-set storage.
 *
 * Entities are 32-bit handles: low 20 bits index, high 12 bits generation, so a
 * stale handle to a recycled slot is detected instead of silently aliasing.
 * Each component type lives in its own sparse set (dense array of values plus
 * an index map), which keeps iteration over one component cache friendly and
 * makes add/remove O(1) via swap-remove.
 */
                            

const INDEX_BITS = 20;
const INDEX_MASK = (1 << INDEX_BITS) - 1;
const GEN_MASK = 0xfff;

export const entityIndex = (e        ) => e & INDEX_MASK;
export const entityGen = (e        ) => (e >>> INDEX_BITS) & GEN_MASK;

export class Store    {
           dense      = [];
           entities           = [];
          sparse             = new Int32Array(64).fill(-1);

  get size() { return this.dense.length; }

  has(e        )          {
    const i = entityIndex(e);
    const d = i < this.sparse.length ? this.sparse[i] : -1;
    return d >= 0 && this.entities[d] === e;
  }

  get(e        )                {
    const i = entityIndex(e);
    const d = i < this.sparse.length ? this.sparse[i] : -1;
    return d >= 0 && this.entities[d] === e ? this.dense[d] : undefined;
  }

  set(e        , v   )    {
    const i = entityIndex(e);
    if (i >= this.sparse.length) {
      let n = this.sparse.length;
      while (n <= i) n *= 2;
      const grown = new Int32Array(n).fill(-1);
      grown.set(this.sparse);
      this.sparse = grown;
    }
    const d = this.sparse[i];
    if (d >= 0 && this.entities[d] === e) { this.dense[d] = v; return v; }
    this.sparse[i] = this.dense.length;
    this.dense.push(v);
    this.entities.push(e);
    return v;
  }

  delete(e        )          {
    if (!this.has(e)) return false;
    const i = entityIndex(e);
    const d = this.sparse[i];
    const last = this.dense.length - 1;
    if (d !== last) {
      this.dense[d] = this.dense[last];
      this.entities[d] = this.entities[last];
      this.sparse[entityIndex(this.entities[d])] = d;
    }
    this.dense.pop();
    this.entities.pop();
    this.sparse[i] = -1;
    return true;
  }
}

export class World {
          gens           = [];
          free           = [];
          live             = new Uint8Array(64);
          stores = new Map                        ();
          dead           = [];
  count = 0;

  spawn()         {
    let i        ;
    if (this.free.length) i = this.free.pop() ;
    else {
      i = this.gens.length;
      if (i > INDEX_MASK) throw new Error("entity limit reached");
      this.gens.push(0);
      if (i >= this.live.length) {
        const g = new Uint8Array(this.live.length * 2);
        g.set(this.live);
        this.live = g;
      }
    }
    this.live[i] = 1;
    this.count++;
    return ((this.gens[i] << INDEX_BITS) | i) >>> 0;
  }

  alive(e        )          {
    const i = entityIndex(e);
    return i < this.gens.length && this.live[i] === 1 && this.gens[i] === entityGen(e);
  }

  /** Destroy now. Safe to call during queries only through destroyLater. */
  destroy(e        )       {
    if (!this.alive(e)) return;
    for (const s of this.stores.values()) s.delete(e);
    const i = entityIndex(e);
    this.live[i] = 0;
    this.gens[i] = (this.gens[i] + 1) & GEN_MASK;
    this.free.push(i);
    this.count--;
  }

  /** Queue a destroy for the end of the frame (call flush()). */
  destroyLater(e        )       { this.dead.push(e); }

  flush()         {
    const n = this.dead.length;
    for (const e of this.dead) this.destroy(e);
    this.dead.length = 0;
    return n;
  }

  store   (name        )           {
    let s = this.stores.get(name);
    if (!s) { s = new Store   (); this.stores.set(name, s); }
    return s            ;
  }

  /**
   * Iterate entities that have every named component. Drives the loop from
   * the smallest store so the cost scales with the rarest component.
   */
  *query(...names          )                    {
    const ss = names.map((n) => this.store(n));
    let small = ss[0];
    for (const s of ss) if (s.size < small.size) small = s;
    // copy so destroying during iteration cannot skip entities
    const list = small.entities.slice();
    outer: for (const e of list) {
      for (const s of ss) if (s !== small && !s.has(e)) continue outer;
      if (this.alive(e)) yield e;
    }
  }
}
