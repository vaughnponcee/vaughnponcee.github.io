/**
 * glTF 2.0 model import (.glb, or .gltf with embedded base64 buffers).
 *
 * Walks the default scene's node tree, bakes every node transform into the
 * vertices, and merges all triangle primitives into one MeshData. The result
 * is centred on the origin and scaled to fit a 1x1x1 box, so it behaves like
 * the built-in meshes: object size in the editor sets the real dimensions.
 *
 * Supported: positions, normals (computed when missing), texcoords, u8/u16/u32
 * indices, node matrix or TRS. Not supported yet: textures, skinning, morph
 * targets, Draco/meshopt compression (these models are rejected with a clear
 * error). The first material's base colour is returned for tinting.
 */
                                          
import { STRIDE } from "./mesh.js?v=122c782b";

                                                                                                                                         
                                                                                                     
                                                                                                              
                                                                                                                                           
                
                               
                 
                                 
                     
                                         
                         
                             
                                                   
                                                                          
                                
 

                                                                                                                                     

const SIZES                         = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function decodeBase64(s        )             {
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Parse a .glb (binary) or .gltf (JSON) file. */
export function parseModel(data             )                {
  const bytes = new Uint8Array(data);
  let json      , bin                    = null;
  if (bytes.length >= 12 && new DataView(data).getUint32(0, true) === 0x46546c67) {
    // GLB: header, then JSON chunk, then optional BIN chunk
    const dv = new DataView(data);
    let off = 12;
    json = {}        ;
    while (off + 8 <= bytes.length) {
      const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
      const chunk = bytes.subarray(off + 8, off + 8 + len);
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
      else if (type === 0x004e4942) bin = chunk;
      off += 8 + len;
    }
  } else {
    json = JSON.parse(new TextDecoder().decode(bytes));
  }
  if (json.extensionsRequired?.length) throw new Error(`model needs unsupported extensions: ${json.extensionsRequired.join(", ")}`);

  const buffers = (json.buffers ?? []).map((b, i) => {
    if (b.uri === undefined) { if (!bin) throw new Error("missing GLB binary chunk"); return bin; }
    const m = /^data:[^;]*;base64,(.*)$/.exec(b.uri);
    if (!m) throw new Error(`external buffer "${b.uri}" not supported: export as .glb or embed the data`);
    void i;
    return decodeBase64(m[1]);
  });

  const read = (index        )                             => {
    const acc = json.accessors [index];
    const n = SIZES[acc.type] * acc.count;
    const isFloat = acc.componentType === 5126;
    const out = isFloat ? new Float32Array(n) : new Uint32Array(n);
    if (acc.bufferView === undefined) return out; // all zeros per spec
    const view = json.bufferViews [acc.bufferView];
    const buf = buffers[view.buffer];
    const compBytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType] ;
    const stride = view.byteStride ?? compBytes * SIZES[acc.type];
    const base = buf.byteOffset + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const dv = new DataView(buf.buffer);
    const k = SIZES[acc.type];
    for (let i = 0; i < acc.count; i++)
      for (let c = 0; c < k; c++) {
        const p = base + i * stride + c * compBytes;
        let v        ;
        switch (acc.componentType) {
          case 5126: v = dv.getFloat32(p, true); break;
          case 5125: v = dv.getUint32(p, true); break;
          case 5123: v = dv.getUint16(p, true); if (acc.normalized) v /= 65535; break;
          case 5122: v = dv.getInt16(p, true); if (acc.normalized) v = Math.max(v / 32767, -1); break;
          case 5121: v = dv.getUint8(p); if (acc.normalized) v /= 255; break;
          default: v = dv.getInt8(p); if (acc.normalized) v = Math.max(v / 127, -1);
        }
        out[i * k + c] = v;
      }
    return out;
  };

  const verts           = [], idx           = [];
  let color                           = [0.8, 0.8, 0.8], colorSet = false;

  const local = (n          )           => {
    if (n.matrix) return n.matrix;
    const [tx, ty, tz] = n.translation ?? [0, 0, 0], [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1];
    return [
      (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0,
      (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
      (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
      tx, ty, tz, 1,
    ];
  };
  const mul = (a          , b          ) => {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  };

  const visit = (ni        , parent          , depth        ) => {
    if (depth > 64) throw new Error("node hierarchy too deep (cycle?)");
    const node = json.nodes [ni];
    const m = mul(parent, local(node));
    if (node.mesh !== undefined) {
      for (const prim of json.meshes [node.mesh].primitives) {
        if ((prim.mode ?? 4) !== 4) continue; // triangles only
        if (prim.attributes.POSITION === undefined) continue;
        const pos = read(prim.attributes.POSITION)                ;
        const nrm = prim.attributes.NORMAL !== undefined ? (read(prim.attributes.NORMAL)                ) : null;
        const uv = prim.attributes.TEXCOORD_0 !== undefined ? read(prim.attributes.TEXCOORD_0) : null;
        const count = pos.length / 3, base = verts.length / STRIDE;
        // normals transform by the inverse transpose; for uniform or axis scale the
        // upper 3x3 then renormalize is exact enough for display
        for (let i = 0; i < count; i++) {
          const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
          verts.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
          if (nrm) {
            const a = nrm[i * 3], b = nrm[i * 3 + 1], c = nrm[i * 3 + 2];
            const nx = m[0] * a + m[4] * b + m[8] * c, ny = m[1] * a + m[5] * b + m[9] * c, nz = m[2] * a + m[6] * b + m[10] * c;
            const l = Math.hypot(nx, ny, nz) || 1;
            verts.push(nx / l, ny / l, nz / l);
          } else verts.push(0, 0, 0);
          verts.push(uv ? uv[i * 2] : 0, uv ? uv[i * 2 + 1] : 0);
        }
        const ind = prim.indices !== undefined ? read(prim.indices) : Uint32Array.from({ length: count }, (_, i) => i);
        // a mirroring transform (negative determinant) flips winding
        const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
        for (let i = 0; i + 2 < ind.length; i += 3) {
          if (det < 0) idx.push(base + ind[i], base + ind[i + 2], base + ind[i + 1]);
          else idx.push(base + ind[i], base + ind[i + 1], base + ind[i + 2]);
        }
        if (!nrm) {
          // flat-ish normals: accumulate face normals per vertex
          for (let i = idx.length - (ind.length - (ind.length % 3)); i < idx.length; i += 3) {
            const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]].map((v) => v * STRIDE);
            const u = [verts[b] - verts[a], verts[b + 1] - verts[a + 1], verts[b + 2] - verts[a + 2]];
            const w = [verts[c] - verts[a], verts[c + 1] - verts[a + 1], verts[c + 2] - verts[a + 2]];
            const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
            for (const v of [a, b, c]) { verts[v + 3] += n[0]; verts[v + 4] += n[1]; verts[v + 5] += n[2]; }
          }
          for (let v = base * STRIDE; v < verts.length; v += STRIDE) {
            const l = Math.hypot(verts[v + 3], verts[v + 4], verts[v + 5]) || 1;
            verts[v + 3] /= l; verts[v + 4] /= l; verts[v + 5] /= l;
          }
        }
        if (!colorSet && prim.material !== undefined) {
          const f = json.materials?.[prim.material]?.pbrMetallicRoughness?.baseColorFactor;
          if (f) {
            // glTF colours are linear; the renderer expects sRGB-authored colours
            color = [f[0], f[1], f[2]].map((c) => Math.pow(c, 1 / 2.2))                            ;
            colorSet = true;
          }
        }
      }
    }
    for (const c of node.children ?? []) visit(c, m, depth + 1);
  };

  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? (json.nodes ?? []).map((_, i) => i);
  for (const r of roots) visit(r, I, 0);
  if (!idx.length) throw new Error("no triangle meshes found in this model");

  // centre and fit into a unit cube
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < verts.length; v += STRIDE) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], verts[v + k]); max[k] = Math.max(max[k], verts[v + k]); }
  const ext = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const s = 1 / Math.max(...ext, 1e-9);
  const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  let radius = 0;
  for (let v = 0; v < verts.length; v += STRIDE) {
    for (let k = 0; k < 3; k++) verts[v + k] = (verts[v + k] - c[k]) * s;
    radius = Math.max(radius, Math.hypot(verts[v], verts[v + 1], verts[v + 2]));
  }
  const nv = verts.length / STRIDE;
  const mesh           = { vertices: new Float32Array(verts), indices: nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), radius };
  return { mesh, color, triangles: idx.length / 3, size: [ext[0] * s, ext[1] * s, ext[2] * s] };
}

/** Base64 helpers so models can live inside scene JSON. */
export function toBase64(data             )         {
  const b = new Uint8Array(data);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(s        )              { return decodeBase64(s).buffer               ; }
