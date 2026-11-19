/**
 * Small linear algebra kit. Matrices are column-major Float32Array(16), the
 * layout WebGL expects, so they upload without transposing.
 */
                                            
                                
                                                    

export const v3 = (x = 0, y = 0, z = 0)       => [x, y, z];
export const add = (a      , b      )       => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a      , b      )       => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a      , s        )       => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a      , b      )         => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a      , b      )       => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a      )         => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a      )       => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
export const lerp = (a        , b        , t        )         => a + (b - a) * t;
export const lerp3 = (a      , b      , t        )       => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const clamp = (x        , lo        , hi        )         => (x < lo ? lo : x > hi ? hi : x);
/** Frame-rate independent exponential smoothing factor. */
export const damp = (rate        , dt        )         => 1 - Math.exp(-rate * dt);

export function identity(out       = new Float32Array(16))       {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

export function multiply(a      , b      , out       = new Float32Array(16))       {
  // out may alias a or b, so read everything first
  const r = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let rI = 0; rI < 4; rI++) {
      r[c * 4 + rI] =
        a[rI] * b[c * 4] + a[4 + rI] * b[c * 4 + 1] + a[8 + rI] * b[c * 4 + 2] + a[12 + rI] * b[c * 4 + 3];
    }
  }
  out.set(r);
  return out;
}

export function perspective(fovY        , aspect        , near        , far        , out       = new Float32Array(16))       {
  const f = 1 / Math.tan(fovY / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function ortho(l        , r        , b        , t        , n        , f        , out       = new Float32Array(16))       {
  out.fill(0);
  out[0] = 2 / (r - l);
  out[5] = 2 / (t - b);
  out[10] = -2 / (f - n);
  out[12] = -(r + l) / (r - l);
  out[13] = -(t + b) / (t - b);
  out[14] = -(f + n) / (f - n);
  out[15] = 1;
  return out;
}

export function lookAt(eye      , target      , up      , out       = new Float32Array(16))       {
  let z = normalize(sub(eye, target));
  if (len(z) === 0) z = [0, 0, 1];
  let x = normalize(cross(up, z));
  if (len(x) === 0) x = normalize(cross([0, 0, 1], z)); // looking straight along up
  const y = cross(z, x);
  out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0;
  out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0;
  out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0;
  out[12] = -dot(x, eye); out[13] = -dot(y, eye); out[14] = -dot(z, eye); out[15] = 1;
  return out;
}

export function quatFromEuler(yaw        , pitch = 0, roll = 0)       {
  // yaw about Y, then pitch about X, then roll about Z
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  const cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
  return [
    cy * sp * cr + sy * cp * sr,
    sy * cp * cr - cy * sp * sr,
    cy * cp * sr - sy * sp * cr,
    cy * cp * cr + sy * sp * sr,
  ];
}

export function quatMul(a      , b      )       {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function rotateVec(q      , v      )       {
  const u       = [q[0], q[1], q[2]];
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q[3])), cross(u, t));
}

/** Model matrix from translation, rotation and scale. */
export function fromTRS(t      , q      , s      , out       = new Float32Array(16))       {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  out[0] = (1 - (yy + zz)) * s[0]; out[1] = (xy + wz) * s[0]; out[2] = (xz - wy) * s[0]; out[3] = 0;
  out[4] = (xy - wz) * s[1]; out[5] = (1 - (xx + zz)) * s[1]; out[6] = (yz + wx) * s[1]; out[7] = 0;
  out[8] = (xz + wy) * s[2]; out[9] = (yz - wx) * s[2]; out[10] = (1 - (xx + yy)) * s[2]; out[11] = 0;
  out[12] = t[0]; out[13] = t[1]; out[14] = t[2]; out[15] = 1;
  return out;
}

export function invert(m      , out       = new Float32Array(16))              {
  const a = m;
  const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4];
  const b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5];
  const b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
  const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12];
  const b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13];
  const b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-20) return null;
  det = 1 / det;
  const r = new Float32Array(16);
  r[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det;
  r[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
  r[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det;
  r[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
  r[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det;
  r[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
  r[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det;
  r[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
  r[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det;
  r[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
  r[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det;
  r[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
  r[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det;
  r[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
  r[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det;
  r[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
  out.set(r);
  return out;
}

export function transformPoint(m      , p      )       {
  const x = p[0], y = p[1], z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

/**
 * Frustum as 6 planes (nx, ny, nz, d) extracted from a view-projection matrix
 * (Gribb & Hartmann). A point p is inside plane i when n.p + d >= 0.
 */
export function frustumPlanes(vp      )               {
  const p = new Float32Array(24);
  const row = (r        , c        ) => vp[c * 4 + r];
  const set = (i        , s        , r        ) => {
    let a = row(3, 0) + s * row(r, 0), b = row(3, 1) + s * row(r, 1);
    let c = row(3, 2) + s * row(r, 2), d = row(3, 3) + s * row(r, 3);
    const l = Math.hypot(a, b, c);
    p[i * 4] = a / l; p[i * 4 + 1] = b / l; p[i * 4 + 2] = c / l; p[i * 4 + 3] = d / l;
  };
  set(0, 1, 0); set(1, -1, 0); // left, right
  set(2, 1, 1); set(3, -1, 1); // bottom, top
  set(4, 1, 2); set(5, -1, 2); // near, far
  return p;
}

export function sphereInFrustum(planes              , c      , r        )          {
  for (let i = 0; i < 6; i++) {
    const o = i * 4;
    if (planes[o] * c[0] + planes[o + 1] * c[1] + planes[o + 2] * c[2] + planes[o + 3] < -r) return false;
  }
  return true;
}

/** Seeded PRNG (mulberry32) so demo levels and tests are reproducible. */
export function rng(seed        )               {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
