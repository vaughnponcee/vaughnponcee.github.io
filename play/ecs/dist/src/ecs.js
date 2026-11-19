/**
 * Entity-Component-System core.
 *
 * - Entities are 32-bit handles: low 20 bits = slot index, high 12 bits =
 *   generation. Destroying an entity bumps its slot's generation, so stale
 *   handles fail `alive()` instead of silently aliasing a recycled slot.
 * - Components are structs-of-arrays: each field is its own typed array
 *   indexed by slot, so systems stream through contiguous memory.
 * - Membership is a sparse set per component (dense list of slots + sparse
 *   slot->dense map): O(1) add/remove/has and tight iteration.
 * - Queries iterate the smallest member set and test the rest.
 * - Structural changes during iteration go through a command buffer
 *   (`defer`) and are applied by `flush()`.
 */

                            

const INDEX_BITS = 20;
const INDEX_MASK = (1 << INDEX_BITS) - 1;
const GEN_MASK = 0xfff;
export const MAX_ENTITIES = 1 << INDEX_BITS;

export const indexOf = (e        )         => e & INDEX_MASK;
export const genOf = (e        )         => (e >>> INDEX_BITS) & GEN_MASK;
const pack = (index        , gen        )         => ((gen & GEN_MASK) << INDEX_BITS | index) >>> 0;

                                                                                            
                                                                          
                                                                                                    
                                               
                                                                      

export class SparseSet {
  dense             ;
  sparse            ;
  size = 0;

  constructor(capacity        ) {
    this.dense = new Uint32Array(capacity);
    this.sparse = new Int32Array(capacity).fill(-1);
  }

  has(i        )          {
    const d = this.sparse[i];
    return d !== -1 && d < this.size && this.dense[d] === i;
  }

  add(i        )          {
    if (this.has(i)) return false;
    this.dense[this.size] = i;
    this.sparse[i] = this.size++;
    return true;
  }

  /** Swap-remove: O(1), does not preserve order. */
  remove(i        )          {
    if (!this.has(i)) return false;
    const d = this.sparse[i];
    const last = this.dense[--this.size];
    this.dense[d] = last;
    this.sparse[last] = d;
    this.sparse[i] = -1;
    return true;
  }

  grow(capacity        )       {
    const dense = new Uint32Array(capacity);
    dense.set(this.dense);
    const sparse = new Int32Array(capacity).fill(-1);
    sparse.set(this.sparse);
    this.dense = dense;
    this.sparse = sparse;
  }
}

export class Component                            {
           id        ;
           name        ;
           schema   ;
           set;          ;
  data           ;

  constructor(id        , name        , schema   , capacity        ) {
    this.id = id;
    this.name = name;
    this.schema = schema;
    this.set = new SparseSet(capacity);
    const data                             = {};
    for (const k of Object.keys(schema)) data[k] = new schema[k](capacity);
    this.data = data             ;
  }

  grow(capacity        )       {
    this.set.grow(capacity);
    for (const k of Object.keys(this.schema)) {
      const next = new this.schema[k](capacity);
      next.set(this.data[k]         );
      (this.data                              )[k] = next;
    }
  }
}

                                                                                                             
                                       

export class World {
  capacity        ;
          generations             ;
          live            ;
          freeList           = [];
          nextIndex = 0;
          aliveCount = 0;
          components              = [];
          commands            = [];
  /** per-entity tag bits for cheap "kind" checks (bullet/asteroid/...) */
  tags             ;

  constructor(initialCapacity = 1024) {
    this.capacity = initialCapacity;
    this.generations = new Uint16Array(initialCapacity);
    this.live = new Uint8Array(initialCapacity);
    this.tags = new Uint32Array(initialCapacity);
  }

  get count()         {
    return this.aliveCount;
  }

  defineComponent                  (name        , schema   )               {
    const c = new Component(this.components.length, name, schema, this.capacity);
    this.components.push(c                        );
    return c;
  }

          grow()       {
    const cap = Math.min(MAX_ENTITIES, this.capacity * 2);
    if (cap === this.capacity) throw new Error(`entity limit ${MAX_ENTITIES} reached`);
    const gens = new Uint16Array(cap);
    gens.set(this.generations);
    this.generations = gens;
    const live = new Uint8Array(cap);
    live.set(this.live);
    this.live = live;
    const tags = new Uint32Array(cap);
    tags.set(this.tags);
    this.tags = tags;
    for (const c of this.components) c.grow(cap);
    this.capacity = cap;
  }

  create()         {
    let i        ;
    if (this.freeList.length) i = this.freeList.pop()          ;
    else {
      if (this.nextIndex >= this.capacity) this.grow();
      i = this.nextIndex++;
    }
    this.aliveCount++;
    this.live[i] = 1;
    return pack(i, this.generations[i]);
  }

  alive(e        )          {
    const i = indexOf(e);
    return i < this.nextIndex && this.live[i] === 1 && (this.generations[i] & GEN_MASK) === genOf(e);
  }

  destroy(e        )          {
    if (!this.alive(e)) return false;
    const i = indexOf(e);
    for (const c of this.components) c.set.remove(i);
    this.generations[i] = (this.generations[i] + 1) & GEN_MASK;
    this.live[i] = 0;
    this.tags[i] = 0;
    this.freeList.push(i);
    this.aliveCount--;
    return true;
  }

  add                  (e        , c              , init                                   )       {
    if (!this.alive(e)) throw new Error(`add ${c.name} to dead entity ${e}`);
    const i = indexOf(e);
    c.set.add(i);
    for (const k of Object.keys(c.schema)) (c.data                              )[k][i] = (init?.[k]          ) ?? 0;
  }

  remove(e        , c           )          {
    return this.alive(e) && c.set.remove(indexOf(e));
  }

  has(e        , c           )          {
    return this.alive(e) && c.set.has(indexOf(e));
  }

  /** Handle for the entity living in slot `i` (for use inside queries). */
  entityAt(i        )         {
    return pack(i, this.generations[i]);
  }

  /**
   * Calls fn(slot) for every entity that has all `cs` (and none of `without`).
   * Iterates a snapshot of the smallest set, so removing the *current*
   * entity's components inside fn is safe; use defer() for create/destroy.
   */
  query(cs             , fn                     , without              = [])       {
    let smallest = cs[0];
    for (const c of cs) if (c.set.size < smallest.set.size) smallest = c;
    const n = smallest.set.size;
    const snapshot = smallest.set.dense.slice(0, n);
    outer: for (let k = 0; k < n; k++) {
      const i = snapshot[k];
      for (const c of cs) if (c !== smallest && !c.set.has(i)) continue outer;
      for (const c of without) if (c.set.has(i)) continue outer;
      fn(i);
    }
  }

  queryCount(cs             )         {
    let n = 0;
    this.query(cs, () => n++);
    return n;
  }

  defer = {
    destroy: (e        )       => {
      this.commands.push({ kind: 0, e });
    },
    add: (e        , c           , init                         )       => {
      this.commands.push({ kind: 1, e, c, init });
    },
    remove: (e        , c           )       => {
      this.commands.push({ kind: 2, e, c });
    },
  };

  /** Apply deferred commands in order. Destroying twice is harmless. */
  flush()         {
    const cmds = this.commands;
    this.commands = [];
    for (const cmd of cmds) {
      if (cmd.kind === 0) this.destroy(cmd.e);
      else if (cmd.kind === 1) { if (this.alive(cmd.e)) this.add(cmd.e, cmd.c, cmd.init); }
      else this.remove(cmd.e, cmd.c);
    }
    return cmds.length;
  }
}
