/**
 * Uniform-grid spatial hash for broad-phase collision.
 *
 * Rebuilt every step from scratch (clear is O(buckets), insert O(cells
 * touched)). Storage is preallocated typed arrays used as singly-linked
 * lists per bucket, so a frame does zero allocations after warm-up.
 * Objects larger than a cell are inserted into every cell their AABB
 * overlaps; pair output is de-duplicated with a per-query stamp.
 */

const P1 = 73856093;
const P2 = 19349663;

export class SpatialHash {
           cellSize        ;
          inv        ;
          mask        ;
          heads            ;        // bucket -> first node, -1 = empty
          next            ;         // node -> next node in bucket
          item            ;         // node -> item id
          cellX            ;        // node -> cell coords (to reject hash collisions)
          cellY            ;
          nodes = 0;
          stamp             ;       // item id -> last query stamp (dedupe)
          stampValue = 0;
  // per-item bounds, so pair tests need no external lookups
  minX              ; minY              ; maxX              ; maxY              ;
          inserted            ;
  insertedCount = 0;
  /** candidate pairs examined in the last pairs() call (for stats) */
  checks = 0;

  constructor(cellSize        , maxItems = 4096, buckets = 4096) {
    this.cellSize = cellSize;
    this.inv = 1 / cellSize;
    let b = 1;
    while (b < buckets) b <<= 1;
    this.mask = b - 1;
    this.heads = new Int32Array(b).fill(-1);
    const nodeCap = maxItems * 4;
    this.next = new Int32Array(nodeCap);
    this.item = new Int32Array(nodeCap);
    this.cellX = new Int32Array(nodeCap);
    this.cellY = new Int32Array(nodeCap);
    this.stamp = new Uint32Array(maxItems);
    this.minX = new Float32Array(maxItems);
    this.minY = new Float32Array(maxItems);
    this.maxX = new Float32Array(maxItems);
    this.maxY = new Float32Array(maxItems);
    this.inserted = new Int32Array(maxItems);
  }

          bucket(cx        , cy        )         {
    return ((Math.imul(cx, P1) ^ Math.imul(cy, P2)) >>> 0) & this.mask;
  }

  clear()       {
    this.heads.fill(-1);
    this.nodes = 0;
    this.insertedCount = 0;
  }

          ensure(id        , extraNodes        )       {
    if (id >= this.stamp.length) {
      const cap = Math.max(id + 1, this.stamp.length * 2);
      for (const k of ["stamp", "minX", "minY", "maxX", "maxY", "inserted"]         ) {
        const old = this[k]                                           ;
        const n = new (old.constructor                           )(k === "inserted" ? cap : cap);
        n.set(old                );
        (this                           )[k] = n;
      }
    }
    if (this.nodes + extraNodes > this.next.length) {
      const cap = Math.max(this.nodes + extraNodes, this.next.length * 2);
      for (const k of ["next", "item", "cellX", "cellY"]         ) {
        const n = new Int32Array(cap);
        n.set(this[k]);
        (this                           )[k] = n;
      }
    }
  }

  insert(id        , minX        , minY        , maxX        , maxY        )       {
    const x0 = Math.floor(minX * this.inv), x1 = Math.floor(maxX * this.inv);
    const y0 = Math.floor(minY * this.inv), y1 = Math.floor(maxY * this.inv);
    this.ensure(id, (x1 - x0 + 1) * (y1 - y0 + 1));
    this.minX[id] = minX; this.minY[id] = minY; this.maxX[id] = maxX; this.maxY[id] = maxY;
    this.inserted[this.insertedCount++] = id;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const b = this.bucket(cx, cy);
        const n = this.nodes++;
        this.item[n] = id;
        this.cellX[n] = cx;
        this.cellY[n] = cy;
        this.next[n] = this.heads[b];
        this.heads[b] = n;
      }
    }
  }

  /** Calls fn(id) once per item whose AABB overlaps the box. */
  query(minX        , minY        , maxX        , maxY        , fn                      )       {
    const s = ++this.stampValue;
    const x0 = Math.floor(minX * this.inv), x1 = Math.floor(maxX * this.inv);
    const y0 = Math.floor(minY * this.inv), y1 = Math.floor(maxY * this.inv);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (let n = this.heads[this.bucket(cx, cy)]; n !== -1; n = this.next[n]) {
          if (this.cellX[n] !== cx || this.cellY[n] !== cy) continue; // hash collision
          const id = this.item[n];
          if (this.stamp[id] === s) continue;
          this.stamp[id] = s;
          if (this.maxX[id] < minX || this.minX[id] > maxX || this.maxY[id] < minY || this.minY[id] > maxY) continue;
          fn(id);
        }
      }
    }
  }

  /** Every overlapping AABB pair (a < b) exactly once. */
  pairs(fn                                )       {
    let checks = 0;
    for (let k = 0; k < this.insertedCount; k++) {
      const a = this.inserted[k];
      this.query(this.minX[a], this.minY[a], this.maxX[a], this.maxY[a], (b) => {
        checks++;
        if (a < b) fn(a, b);
      });
    }
    this.checks = checks;
  }
}
