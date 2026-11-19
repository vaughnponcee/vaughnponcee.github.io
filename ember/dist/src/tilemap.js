/**
 * Grid tilemap with collision for 2D games.
 *
 * Tiles are integers (0 = empty). Which tiles are solid, and which are
 * one-way platforms you can jump up through, is configurable. moveAndCollide
 * resolves an axis-aligned box against the grid one axis at a time, the
 * standard approach for tight platformer controls: it never tunnels, since
 * each axis is swept in steps no larger than one tile.
 */
                                                                 

                                                                     // x,y = top-left
                                                                                                    

export class Tilemap {
           w        ;
           h        ;
           size        ;
           tiles             ;
  solid = new Set        ();
  oneWay = new Set        ();

  constructor(w        , h        , size        ) {
    this.w = w;
    this.h = h;
    this.size = size;
    this.tiles = new Uint16Array(w * h);
  }

  /** Build from rows of characters, using `legend` to map chars to tile ids. */
  static fromStrings(rows          , size        , legend                        )          {
    const w = Math.max(...rows.map((r) => r.length));
    const m = new Tilemap(w, rows.length, size);
    rows.forEach((row, y) => [...row].forEach((ch, x) => m.set(x, y, legend[ch] ?? 0)));
    return m;
  }

  get(x        , y        )         {
    if (x < 0 || x >= this.w) return 1; // walls outside the map
    if (y < 0) return 0; // open sky above
    if (y >= this.h) return 0; // pits are open
    return this.tiles[y * this.w + x];
  }

  set(x        , y        , t        )       {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.tiles[y * this.w + x] = t;
  }

  isSolid(x        , y        )          {
    const t = this.get(x, y);
    return t !== 0 && (this.solid.has(t) || (x < 0 || x >= this.w));
  }

  /** Every tile cell a box overlaps. */
          span(a        , len        ) {
    const s = this.size;
    return [Math.floor(a / s), Math.floor((a + len - 1e-6) / s)];
  }

  /**
   * Move a box by (dx, dy), stopping at solid tiles. Mutates b.
   * One-way tiles only block downward motion from above.
   */
  moveAndCollide(b      , dx        , dy        , dropThrough = false)             {
    const res             = { hitX: false, hitY: false, onGround: false, hitCeiling: false };
    const s = this.size;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (s * 0.5)));
    const sx = dx / steps, sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      if (!res.hitX && sx !== 0) {
        b.x += sx;
        const [y0, y1] = this.span(b.y, b.h);
        const col = sx > 0 ? Math.floor((b.x + b.w - 1e-6) / s) : Math.floor(b.x / s);
        for (let ty = y0; ty <= y1; ty++) {
          if (this.isSolid(col, ty)) {
            b.x = sx > 0 ? col * s - b.w : (col + 1) * s;
            res.hitX = true;
            break;
          }
        }
      }
      if (!res.hitY && sy !== 0) {
        const prevBottom = b.y + b.h;
        b.y += sy;
        const [x0, x1] = this.span(b.x, b.w);
        const row = sy > 0 ? Math.floor((b.y + b.h - 1e-6) / s) : Math.floor(b.y / s);
        for (let tx = x0; tx <= x1; tx++) {
          const t = this.get(tx, row);
          const blocks = this.isSolid(tx, row) ||
            (sy > 0 && !dropThrough && this.oneWay.has(t) && prevBottom <= row * s + 1e-6);
          if (blocks) {
            if (sy > 0) { b.y = row * s - b.h; res.onGround = true; } else { b.y = (row + 1) * s; res.hitCeiling = true; }
            res.hitY = true;
            break;
          }
        }
      }
    }
    return res;
  }

  /** True if the box is standing on something (solid or one-way) right now. */
  grounded(b      )          {
    const s = this.size;
    const row = Math.floor((b.y + b.h + 0.5) / s);
    if (Math.abs(b.y + b.h - row * s) > 0.5) return false;
    const [x0, x1] = this.span(b.x, b.w);
    for (let tx = x0; tx <= x1; tx++) if (this.isSolid(tx, row) || this.oneWay.has(this.get(tx, row))) return true;
    return false;
  }

  /** Draw only the tiles inside the camera view. frames[t] is the art for tile t. */
  draw(sb             , frames                       , cam          , viewW        , viewH        )         {
    const s = this.size;
    const hw = viewW / 2 / cam.zoom, hh = viewH / 2 / cam.zoom;
    const x0 = Math.max(0, Math.floor((cam.x - hw) / s)), x1 = Math.min(this.w - 1, Math.floor((cam.x + hw) / s));
    const y0 = Math.max(0, Math.floor((cam.y - hh) / s)), y1 = Math.min(this.h - 1, Math.floor((cam.y + hh) / s));
    let n = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const f = frames[this.tiles[y * this.w + x]];
        if (!f) continue;
        sb.draw(f, x * s, y * s, s, s, { ox: 0, oy: 0 });
        n++;
      }
    return n;
  }
}
