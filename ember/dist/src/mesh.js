/**
 * Procedural geometry as plain arrays: interleaved position + normal + uv
 * (8 floats per vertex) and a 16-bit index list. No GPU code here, so the
 * shapes are unit tested in Node.
 */
                           
                                               
                       
                                                                            
                 
 

export const STRIDE = 8;

function finish(v          , i          )           {
  let r = 0;
  for (let k = 0; k < v.length; k += STRIDE) r = Math.max(r, Math.hypot(v[k], v[k + 1], v[k + 2]));
  if (v.length / STRIDE > 65535) throw new Error("mesh too large for 16-bit indices");
  return { vertices: new Float32Array(v), indices: new Uint16Array(i), radius: r };
}

/** Unit cube centred on the origin (side 1), 24 vertices so each face has flat normals. */
export function box()           {
  const v           = [], idx           = [];
  const faces                                   = [
    // normal, u axis, v axis
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  for (const [n, u, w] of faces) {
    const base = v.length / STRIDE;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      v.push(
        0.5 * (n[0] + su * u[0] + sv * w[0]),
        0.5 * (n[1] + su * u[1] + sv * w[1]),
        0.5 * (n[2] + su * u[2] + sv * w[2]),
        n[0], n[1], n[2],
        (su + 1) / 2, (sv + 1) / 2,
      );
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return finish(v, idx);
}

/** UV sphere of radius 0.5. */
export function sphere(seg = 24, rings = 16)           {
  const v           = [], idx           = [];
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    for (let s = 0; s <= seg; s++) {
      const th = (s / seg) * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(th), y = Math.cos(phi), z = -Math.sin(phi) * Math.sin(th);
      v.push(x * 0.5, y * 0.5, z * 0.5, x, y, z, s / seg, r / rings);
    }
  }
  for (let r = 0; r < rings; r++)
    for (let s = 0; s < seg; s++) {
      const a = r * (seg + 1) + s, b = a + seg + 1;
      if (r !== 0) idx.push(a, b, a + 1);
      if (r !== rings - 1) idx.push(a + 1, b, b + 1);
    }
  return finish(v, idx);
}

/** Flat plane on XZ, size 1, facing +Y, with uv repeated `tile` times. */
export function plane(tile = 1)           {
  const v = [
    -0.5, 0, 0.5, 0, 1, 0, 0, 0,
    0.5, 0, 0.5, 0, 1, 0, tile, 0,
    0.5, 0, -0.5, 0, 1, 0, tile, tile,
    -0.5, 0, -0.5, 0, 1, 0, 0, tile,
  ];
  return finish(v, [0, 1, 2, 0, 2, 3]);
}

/** Cylinder of radius 0.5 and height 1 with caps. */
export function cylinder(seg = 24)           {
  const v           = [], idx           = [];
  for (let s = 0; s <= seg; s++) {
    const th = (s / seg) * Math.PI * 2, x = Math.cos(th), z = -Math.sin(th);
    v.push(x * 0.5, -0.5, z * 0.5, x, 0, z, s / seg, 0);
    v.push(x * 0.5, 0.5, z * 0.5, x, 0, z, s / seg, 1);
  }
  for (let s = 0; s < seg; s++) {
    const a = s * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  for (const y of [-0.5, 0.5]) {
    const ny = Math.sign(y), c = v.length / STRIDE;
    v.push(0, y, 0, 0, ny, 0, 0.5, 0.5);
    for (let s = 0; s <= seg; s++) {
      const th = (s / seg) * Math.PI * 2, x = Math.cos(th), z = -Math.sin(th);
      v.push(x * 0.5, y, z * 0.5, 0, ny, 0, 0.5 + x * 0.5, 0.5 + z * 0.5);
    }
    for (let s = 0; s < seg; s++) {
      if (ny > 0) idx.push(c, c + 1 + s, c + 2 + s);
      else idx.push(c, c + 2 + s, c + 1 + s);
    }
  }
  return finish(v, idx);
}

/** Octahedron-ish gem with flat faces, radius 0.5. */
export function gem()           {
  const top = [0, 0.5, 0], bot = [0, -0.5, 0];
  const ring             = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    ring.push([Math.cos(a) * 0.32, 0.08, -Math.sin(a) * 0.32]);
  }
  const v           = [], idx           = [];
  const tri = (p          , q          , r          ) => {
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], w = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(n[0], n[1], n[2]);
    n = n.map((x) => x / l);
    const b = v.length / STRIDE;
    for (const pt of [p, q, r]) v.push(pt[0], pt[1], pt[2], n[0], n[1], n[2], 0, 0);
    idx.push(b, b + 1, b + 2);
  };
  for (let k = 0; k < 6; k++) {
    const a = ring[k], b = ring[(k + 1) % 6];
    tri(top, a, b);
    tri(bot, b, a);
  }
  return finish(v, idx);
}

/** Signed volume via the divergence theorem. A closed, outward-wound mesh is positive. */
export function signedVolume(m          )         {
  let vol = 0;
  const p = m.vertices, ix = m.indices;
  for (let k = 0; k < ix.length; k += 3) {
    const a = ix[k] * STRIDE, b = ix[k + 1] * STRIDE, c = ix[k + 2] * STRIDE;
    vol += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
      - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
      + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  return vol;
}
