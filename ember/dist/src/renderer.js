/**
 * WebGL2 forward renderer.
 *
 * Every draw call is queued, frustum culled, grouped by mesh and drawn with
 * hardware instancing (one call per mesh per pass). Lighting: a sun with a
 * 2048x2048 PCF shadow map fitted around the camera focus, a sky/ground
 * hemisphere ambient, up to 8 point lights, exponential height fog, ACES
 * tonemapping and sRGB output. Emissive instances bypass lighting.
 */
import {                       frustumPlanes, invert, lookAt, multiply, normalize, ortho, perspective, sphereInFrustum } from "./math.js";
import {                STRIDE } from "./mesh.js";

                                                                                                                                   
                                                                                           
                                                                      

export const MAX_LIGHTS = 8;
const INST_FLOATS = 16 + 4 + 4; // model, color, (emissive, rough, -, -)

const MAIN_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUv;
layout(location=3) in mat4 iModel;
layout(location=7) in vec4 iColor;
layout(location=8) in vec4 iExtra;
uniform mat4 uViewProj, uShadowMat;
out vec3 vWorld, vNrm; out vec4 vColor, vExtra, vShadow; out vec2 vUv;
void main(){
  vec4 w = iModel * vec4(aPos,1.0);
  vWorld = w.xyz;
  vNrm = normalize(mat3(iModel) * aNrm); // uniform or axis scales only
  vColor = iColor; vExtra = iExtra; vUv = aUv;
  vShadow = uShadowMat * w;
  gl_Position = uViewProj * w;
}`;

const MAIN_FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vWorld, vNrm; in vec4 vColor, vExtra, vShadow; in vec2 vUv;
uniform vec3 uCam, uSunDir, uSunColor, uSky, uGround, uFog; // sky/ground/fog given in sRGB
uniform float uFogDensity, uShadowTexel, uTime, uExposure, uAmbient;
uniform sampler2DShadow uShadowMap;
uniform int uLightCount;
uniform vec4 uLightPos[${MAX_LIGHTS}];   // xyz, radius
uniform vec3 uLightColor[${MAX_LIGHTS}];
out vec4 frag;

float shadow(vec3 n){
  vec3 p = vShadow.xyz / vShadow.w * 0.5 + 0.5;
  if(p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0||p.z>1.0) return 1.0;
  float bias = max(0.0025*(1.0-dot(n,uSunDir)), 0.0006);
  float s = 0.0;
  for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++)
    s += texture(uShadowMap, vec3(p.xy+vec2(x,y)*uShadowTexel, p.z-bias));
  return s/9.0;
}
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }

void main(){
  vec3 base = pow(vColor.rgb, vec3(2.2)); // authored colours are sRGB
  // subtle checker so large flat surfaces read as scale
  if(vExtra.z > 0.5){
    vec2 c = floor(vWorld.xz*0.5);
    base *= mix(0.86, 1.0, mod(c.x+c.y, 2.0));
  }
  vec3 col;
  if(vExtra.x > 0.0){
    col = base * vExtra.x;
  } else {
    vec3 n = normalize(vNrm);
    vec3 v = normalize(uCam - vWorld);
    float ndl = max(dot(n,uSunDir),0.0);
    vec3 h = normalize(uSunDir+v);
    float gloss = mix(8.0, 96.0, 1.0-vExtra.y);
    float spec = pow(max(dot(n,h),0.0), gloss) * (1.0-vExtra.y) * 0.6;
    float sh = ndl > 0.0 ? shadow(n) : 0.0;
    vec3 amb = pow(mix(uGround, uSky, n.y*0.5+0.5), vec3(2.2)) * uAmbient;
    col = base*(amb + uSunColor*ndl*sh) + uSunColor*spec*sh;
    for(int i=0;i<${MAX_LIGHTS};i++){
      if(i>=uLightCount) break;
      vec3 L = uLightPos[i].xyz - vWorld;
      float d = length(L), r = uLightPos[i].w;
      if(d>=r) continue;
      L/=d;
      float f = 1.0 - d*d/(r*r); f*=f;
      float nl = max(dot(n,L),0.0);
      col += (base*nl + pow(max(dot(n,normalize(L+v)),0.0),gloss)*(1.0-vExtra.y)*0.5) * uLightColor[i] * f;
    }
  }
  float dist = length(vWorld-uCam);
  float fog = 1.0 - exp(-dist*uFogDensity*exp(-max(vWorld.y,0.0)*0.08));
  col = mix(col, pow(uFog, vec3(2.2)), clamp(fog,0.0,1.0));
  col = aces(col * uExposure);
  frag = vec4(pow(col, vec3(1.0/2.2)), 1.0);
}`;

const SHADOW_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=3) in mat4 iModel;
uniform mat4 uLightVP;
void main(){ gl_Position = uLightVP * iModel * vec4(aPos,1.0); }`;
const SHADOW_FS = `#version 300 es
precision mediump float; void main(){}`;

const SKY_VS = `#version 300 es
out vec2 vNdc;
void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2)*2.0-1.0; vNdc=p; gl_Position=vec4(p,0.9999,1.0); }`;
const SKY_FS = `#version 300 es
precision highp float;
in vec2 vNdc; uniform mat4 uInvVP; uniform vec3 uSky, uHorizon, uSunDir, uSunColor; out vec4 frag;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }
void main(){
  vec4 a = uInvVP*vec4(vNdc,-1.0,1.0), b = uInvVP*vec4(vNdc,1.0,1.0);
  vec3 d = normalize(b.xyz/b.w - a.xyz/a.w);
  float t = clamp(d.y*1.6, 0.0, 1.0);
  vec3 col = pow(mix(uHorizon, uSky, pow(t,0.6)), vec3(2.2));
  if(d.y<0.0) col = pow(uHorizon*0.92, vec3(2.2));
  float s = max(dot(d,uSunDir),0.0);
  col += uSunColor*(pow(s,800.0)*10.0 + pow(s,12.0)*0.3);
  frag = vec4(pow(aces(col),vec3(1.0/2.2)),1.0);
}`;

function compile(gl                        , vs        , fs        )               {
  const p = gl.createProgram() ;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]         ) {
    const s = gl.createShader(type) ;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("shader: " + gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("link: " + gl.getProgramInfoLog(p));
  return p;
}

                                                                              

export class Renderer {
           gl                        ;
  sunDir       = normalize([0.45, 0.8, 0.35]);
  sunColor       = [2.2, 2.0, 1.75];
  sky       = [0.16, 0.34, 0.72];
  horizon       = [0.55, 0.64, 0.74];
  ground       = [0.3, 0.26, 0.22];
  fogDensity = 0.0065;
  exposure = 1.0;
  ambient = 2.6;
  shadowSize = 2048;
  shadowExtent = 34;
  lights               = [];
  stats = { draws: 0, instances: 0, culled: 0, ms: 0 };

          main              ;
          shadowProg              ;
          skyProg              ;
          u = new Map                                     ();
          instBuf             ;
          instCap = 0;
          shadowTex              ;
          shadowFbo                  ;
          batches = new Map               ();
          nextMesh = 1;
          skyVao                        ;
           view       = new Float32Array(16);
           proj       = new Float32Array(16);
           viewProj       = new Float32Array(16);

           canvas                   ;

  constructor(canvas                   ) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", { antialias: true, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL2 is not available in this browser");
    this.gl = gl;
    this.main = compile(gl, MAIN_VS, MAIN_FS);
    this.shadowProg = compile(gl, SHADOW_VS, SHADOW_FS);
    this.skyProg = compile(gl, SKY_VS, SKY_FS);
    this.instBuf = gl.createBuffer() ;
    this.skyVao = gl.createVertexArray() ;

    this.shadowTex = gl.createTexture() ;
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, this.shadowSize, this.shadowSize);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowFbo = gl.createFramebuffer() ;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
  }

          loc(p              , name        ) {
    const key = (p === this.main ? "m:" : p === this.skyProg ? "s:" : "d:") + name;
    if (!this.u.has(key)) this.u.set(key, this.gl.getUniformLocation(p, name));
    return this.u.get(key) ;
  }

  createMesh(m          )       {
    const gl = this.gl;
    const vbo = gl.createBuffer() , ibo = gl.createBuffer() ;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, m.vertices, gl.STATIC_DRAW);
    const make = () => {
      const vao = gl.createVertexArray() ;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE * 4, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE * 4, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, STRIDE * 4, 24);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
      for (let k = 0; k < 6; k++) {
        gl.enableVertexAttribArray(3 + k);
        gl.vertexAttribPointer(3 + k, 4, gl.FLOAT, false, INST_FLOATS * 4, k * 16);
        gl.vertexAttribDivisor(3 + k, 1);
      }
      gl.bindVertexArray(null);
      return vao;
    };
    const vao = make();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);
    return { vao, shadowVao: vao, count: m.indices.length, radius: m.radius, id: this.nextMesh++ };
  }

  /**
   * Queue one instance. `scale` is the largest axis scale in `model`, used to
   * size the culling sphere. emissive > 0 makes the instance unlit.
   */
  draw(mesh      , model      , color      , o                                                                                             = {})       {
    let b = this.batches.get(mesh.id);
    if (!b) { b = { mesh, data: [], count: 0, shadow: false }; this.batches.set(mesh.id, b); }
    const pos       = [model[12], model[13], model[14]];
    const r = mesh.radius * (o.scale ?? Math.max(Math.hypot(model[0], model[1], model[2]), Math.hypot(model[4], model[5], model[6]), Math.hypot(model[8], model[9], model[10])));
    const visible = sphereInFrustum(this.planes, pos, r);
    if (!visible) this.stats.culled++;
    if (!visible && !(o.shadow ?? true)) return;
    // invisible casters still go to the shadow pass; flag via negative alpha
    for (let i = 0; i < 16; i++) b.data.push(model[i]);
    b.data.push(color[0], color[1], color[2], visible ? 1 : -1);
    b.data.push(o.emissive ?? 0, o.rough ?? 0.6, o.checker ? 1 : 0, (o.shadow ?? true) ? 1 : 0);
    b.count++;
  }

          planes = new Float32Array(24);

  /** Call before queueing draws so culling uses this frame's camera. */
  begin(cam        )       {
    const w = this.canvas.width, h = this.canvas.height;
    perspective(cam.fov, w / h, cam.near, cam.far, this.proj);
    lookAt(cam.pos, cam.target, [0, 1, 0], this.view);
    multiply(this.proj, this.view, this.viewProj);
    this.planes = frustumPlanes(this.viewProj);
    for (const b of this.batches.values()) { b.data.length = 0; b.count = 0; }
    this.stats.culled = 0;
  }

          upload(data              ) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    if (data.byteLength > this.instCap) {
      this.instCap = Math.max(data.byteLength, this.instCap * 2);
      gl.bufferData(gl.ARRAY_BUFFER, this.instCap, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
  }

  end(cam        , time = 0)       {
    const t0 = performance.now();
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    let draws = 0, instances = 0;

    // shadow camera: ortho box around the camera target, snapped to texels to stop shimmering
    const ext = this.shadowExtent;
    const texel = (2 * ext) / this.shadowSize;
    const c       = [Math.round(cam.target[0] / texel) * texel, 0, Math.round(cam.target[2] / texel) * texel];
    const sd = this.sunDir;
    const eye       = [c[0] + sd[0] * 60, c[1] + sd[1] * 60, c[2] + sd[2] * 60];
    const lightView = lookAt(eye, c, [0, 1, 0]);
    const lightVP = multiply(ortho(-ext, ext, -ext, ext, 1, 140), lightView);

    // shadow pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.shadowProg);
    gl.uniformMatrix4fv(this.loc(this.shadowProg, "uLightVP"), false, lightVP);
    gl.cullFace(gl.FRONT); // front-face culling reduces acne on closed meshes
    const packed = new Map                                                                              ();
    for (const b of this.batches.values()) {
      if (!b.count) continue;
      const all           = [], vis           = [];
      for (let i = 0; i < b.count; i++) {
        const o = i * INST_FLOATS;
        const castShadow = b.data[o + 23] > 0, visible = b.data[o + 19] > 0;
        const slice = b.data.slice(o, o + INST_FLOATS);
        if (castShadow) all.push(...slice);
        if (visible) { slice[19] = 1; vis.push(...slice); }
      }
      packed.set(b.mesh.id, { all: new Float32Array(all), vis: new Float32Array(vis), nAll: all.length / INST_FLOATS, nVis: vis.length / INST_FLOATS });
    }
    for (const b of this.batches.values()) {
      const p = packed.get(b.mesh.id);
      if (!p || !p.nAll) continue;
      this.upload(p.all);
      gl.bindVertexArray(b.mesh.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, b.mesh.count, gl.UNSIGNED_SHORT, 0, p.nAll);
      draws++;
    }
    gl.cullFace(gl.BACK);

    // main pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // sky
    gl.depthMask(false);
    gl.useProgram(this.skyProg);
    const inv = invert(this.viewProj) ;
    gl.uniformMatrix4fv(this.loc(this.skyProg, "uInvVP"), false, inv);
    gl.uniform3fv(this.loc(this.skyProg, "uSky"), this.sky);
    gl.uniform3fv(this.loc(this.skyProg, "uHorizon"), this.horizon);
    gl.uniform3fv(this.loc(this.skyProg, "uSunDir"), this.sunDir);
    gl.uniform3fv(this.loc(this.skyProg, "uSunColor"), this.sunColor);
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    draws++;

    const m = this.main;
    gl.useProgram(m);
    gl.uniformMatrix4fv(this.loc(m, "uViewProj"), false, this.viewProj);
    gl.uniformMatrix4fv(this.loc(m, "uShadowMat"), false, lightVP);
    gl.uniform3fv(this.loc(m, "uCam"), cam.pos);
    gl.uniform3fv(this.loc(m, "uSunDir"), this.sunDir);
    gl.uniform3fv(this.loc(m, "uSunColor"), this.sunColor);
    gl.uniform3fv(this.loc(m, "uSky"), this.sky.map((x) => x * 0.9));
    gl.uniform3fv(this.loc(m, "uGround"), this.ground);
    gl.uniform3fv(this.loc(m, "uFog"), this.horizon);
    gl.uniform1f(this.loc(m, "uFogDensity"), this.fogDensity);
    gl.uniform1f(this.loc(m, "uShadowTexel"), 1 / this.shadowSize);
    gl.uniform1f(this.loc(m, "uTime"), time);
    gl.uniform1f(this.loc(m, "uExposure"), this.exposure);
    gl.uniform1f(this.loc(m, "uAmbient"), this.ambient);
    const lights = this.nearestLights(cam.target);
    const lp = new Float32Array(MAX_LIGHTS * 4), lc = new Float32Array(MAX_LIGHTS * 3);
    lights.forEach((l, i) => { lp.set([...l.pos, l.radius], i * 4); lc.set(l.color, i * 3); });
    gl.uniform1i(this.loc(m, "uLightCount"), lights.length);
    gl.uniform4fv(this.loc(m, "uLightPos"), lp);
    gl.uniform3fv(this.loc(m, "uLightColor"), lc);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.uniform1i(this.loc(m, "uShadowMap"), 0);

    for (const b of this.batches.values()) {
      const p = packed.get(b.mesh.id);
      if (!p || !p.nVis) continue;
      this.upload(p.vis);
      gl.bindVertexArray(b.mesh.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, b.mesh.count, gl.UNSIGNED_SHORT, 0, p.nVis);
      draws++;
      instances += p.nVis;
    }
    gl.bindVertexArray(null);
    this.stats.draws = draws;
    this.stats.instances = instances;
    this.stats.ms = performance.now() - t0;
  }

          nearestLights(focus      )               {
    return this.lights
      .map((l) => ({ l, d: Math.hypot(l.pos[0] - focus[0], l.pos[1] - focus[1], l.pos[2] - focus[2]) - l.radius }))
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_LIGHTS)
      .map((x) => x.l);
  }

  resize()       {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(this.canvas.clientWidth * dpr), h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  /** World ray through a canvas pixel, for picking. */
  screenRay(px        , py        , cam        )                              {
    const x = (px / this.canvas.clientWidth) * 2 - 1, y = 1 - (py / this.canvas.clientHeight) * 2;
    const inv = invert(this.viewProj) ;
    const a = mulH(inv, [x, y, -1]), b = mulH(inv, [x, y, 1]);
    return { origin: cam.pos, dir: normalize([b[0] - a[0], b[1] - a[1], b[2] - a[2]]) };
  }
}

function mulH(m      , p      )       {
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return [
    (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w,
    (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w,
    (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) / w,
  ];
}
