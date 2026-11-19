/**
 * 2D layer: instanced sprite batching on the same WebGL2 context as the 3D
 * renderer. Use it for 2D games, HUDs, menus and debug overlays.
 *
 * One draw call per texture switch. Each sprite is 12 floats: position,
 * size, rotation, origin, uv rect and a packed RGBA tint. Text uses a font
 * atlas generated at startup from the system font, so there are no font files.
 */
import { ortho,           } from "./math.js?v=122c782b";

                                                                    
/** A region of a texture in pixels. */
                                                                                   

const FLOATS = 13; // x y w h rot ox oy u0 v0 u1 v1 rgba(packed) depth

const VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iRect;    // x y w h
layout(location=2) in vec3 iRot;     // rotation, origin x, origin y (0..1)
layout(location=3) in vec4 iUv;      // u0 v0 u1 v1
layout(location=4) in vec4 iColor;   // normalized from packed bytes
layout(location=5) in float iDepth;
uniform mat4 uProj;
out vec2 vUv; out vec4 vColor;
void main(){
  vec2 local = (aCorner - iRot.yz) * iRect.zw;
  float c = cos(iRot.x), s = sin(iRot.x);
  vec2 p = iRect.xy + vec2(local.x*c - local.y*s, local.x*s + local.y*c);
  vUv = mix(iUv.xy, iUv.zw, aCorner);
  vColor = iColor;
  gl_Position = uProj * vec4(p, iDepth, 1.0);
}`;

const FS = `#version 300 es
precision mediump float;
in vec2 vUv; in vec4 vColor; uniform sampler2D uTex; out vec4 frag;
void main(){
  vec4 t = texture(uTex, vUv) * vColor;
  if(t.a < 0.01) discard;
  frag = t;
}`;

                                
               
                                                                  
              
              
                               
                  
                  
 

export class Camera2D {
  x = 0;
  y = 0;
  zoom = 1;
  /** Shake amount in world units, decays each update. */
  shake = 0;
          sx = 0;
          sy = 0;

  update(dt        , rnd = Math.random) {
    this.shake *= Math.exp(-10 * dt);
    this.sx = (rnd() * 2 - 1) * this.shake;
    this.sy = (rnd() * 2 - 1) * this.shake;
  }

  /** Snap the view to whole screen pixels (pixel art: no shimmering edges). */
  pixelSnap = false;

  /** Projection for a viewport of w x h pixels, y down, centred on (x, y). */
  matrix(w        , h        , out       )       {
    const hw = w / 2 / this.zoom, hh = h / 2 / this.zoom;
    let cx = this.x + this.sx, cy = this.y + this.sy;
    if (this.pixelSnap) {
      // left/top edge on an exact screen pixel, whatever the viewport parity
      cx = Math.round((cx - hw) * this.zoom) / this.zoom + hw;
      cy = Math.round((cy - hh) * this.zoom) / this.zoom + hh;
    }
    return ortho(cx - hw, cx + hw, cy + hh, cy - hh, -1, 1, out);
  }

  screenToWorld(px        , py        , w        , h        )                   {
    return [this.x + (px - w / 2) / this.zoom, this.y + (py - h / 2) / this.zoom];
  }
}

export class SpriteBatch {
           gl                        ;
           white         ;
           font                                                                                          ;
  /** Totals since resetStats(); the Engine resets once per frame. */
  stats = { sprites: 0, draws: 0 };

  resetStats()       { this.stats.sprites = 0; this.stats.draws = 0; }

          prog              ;
          vao                        ;
          buf             ;
          data = new Float32Array(FLOATS * 1024);
          u32             ;
          n = 0;
          cur                 = null;
          proj       = new Float32Array(16);
          uProj                      ;
          cap = 0;
  /** Screen pixels per world unit while snapping (set by begin from a pixelSnap camera), else 0. */
          snap = 0;

  constructor(gl                        ) {
    this.gl = gl;
    this.u32 = new Uint32Array(this.data.buffer);
    const p = gl.createProgram() ;
    for (const [t, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]]         ) {
      const sh = gl.createShader(t) ;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error("sprite shader: " + gl.getShaderInfoLog(sh));
      gl.attachShader(p, sh);
    }
    gl.linkProgram(p);
    this.prog = p;
    this.uProj = gl.getUniformLocation(p, "uProj") ;

    this.vao = gl.createVertexArray() ;
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer() ;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.buf = gl.createBuffer() ;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const S = FLOATS * 4;
    const attr = (loc        , size        , off        , type         = gl.FLOAT, norm = false) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, type, norm, S, off);
      gl.vertexAttribDivisor(loc, 1);
    };
    attr(1, 4, 0);
    attr(2, 3, 16);
    attr(3, 4, 28);
    attr(4, 4, 44, gl.UNSIGNED_BYTE, true);
    attr(5, 1, 48);
    gl.bindVertexArray(null);

    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const x = c.getContext("2d") ;
    x.fillStyle = "#fff";
    x.fillRect(0, 0, 1, 1);
    this.white = this.texture(c, true);
    this.font = this.buildFont(32);
  }

  /** Upload a canvas or image. `pixel` = nearest filtering for pixel art. */
  texture(src                                                    , pixel = true)          {
    const gl = this.gl;
    const tex = gl.createTexture() ;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const f = pixel ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, pixel ? gl.NEAREST : gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (!pixel) gl.generateMipmap(gl.TEXTURE_2D);
    return { tex, w: src.width, h: src.height };
  }

  /** Load an image file as a texture. */
  async load(url        , pixel = true)                   {
    const img = new Image();
    img.src = url;
    await img.decode();
    return this.texture(img, pixel);
  }

  /** Cut a texture into a grid of frames (sprite sheet). */
  frames(tex         , fw        , fh        )          {
    const out          = [];
    for (let y = 0; y + fh <= tex.h; y += fh) for (let x = 0; x + fw <= tex.w; x += fw) out.push({ tex, x, y, w: fw, h: fh });
    return out;
  }

          buildFont(size        ) {
    const chars = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("");
    const c = document.createElement("canvas");
    const x = c.getContext("2d") ;
    const fontCss = `600 ${size}px ui-sans-serif, system-ui, "Segoe UI", sans-serif`;
    x.font = fontCss;
    const pad = 2, h = Math.ceil(size * 1.3);
    let w = 0;
    for (const ch of chars) w += Math.ceil(x.measureText(ch).width) + pad * 2;
    c.width = w;
    c.height = h;
    x.font = fontCss;
    x.textBaseline = "top";
    x.fillStyle = "#fff";
    const glyphs = new Map                                  ();
    let cx = 0;
    for (const ch of chars) {
      const gw = Math.ceil(x.measureText(ch).width) + pad * 2;
      x.fillText(ch, cx + pad, size * 0.12);
      glyphs.set(ch, { x: cx, w: gw });
      cx += gw;
    }
    return { tex: this.texture(c, false), glyphs, size, h };
  }

  /** Start a pass: in world space with a camera, or screen space (pixels, y down) without. */
  begin(width        , height        , cam           )       {
    if (cam) cam.matrix(width, height, this.proj);
    else ortho(0, width, height, 0, -1, 1, this.proj);
    this.snap = cam ? (cam.pixelSnap ? cam.zoom : 0) : 1;
    this.n = 0;
    this.cur = null;
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Draw a frame (or whole texture) with its top-left... centred at (x, y) by default. */
  draw(f                 , x        , y        , w         , h         , o                = {})       {
    const fr        = "tex" in f && "x" in f ? (f         ) : { tex: f           , x: 0, y: 0, w: (f           ).w, h: (f           ).h };
    if (this.cur !== fr.tex) { this.flush(); this.cur = fr.tex; }
    if (this.n * FLOATS >= this.data.length) {
      const g = new Float32Array(this.data.length * 2);
      g.set(this.data);
      this.data = g;
      this.u32 = new Uint32Array(g.buffer);
    }
    const d = this.data, k = this.n++ * FLOATS, T = fr.tex;
    let u0 = fr.x / T.w, v0 = fr.y / T.h, u1 = (fr.x + fr.w) / T.w, v1 = (fr.y + fr.h) / T.h;
    if (o.flipX) { const t = u0; u0 = u1; u1 = t; }
    if (o.flipY) { const t = v0; v0 = v1; v1 = t; }
    const sw = w ?? fr.w, sh = h ?? fr.h;
    if (this.snap && !o.rot) {
      // put the sprite's top-left corner on a whole screen pixel
      const ox = o.ox ?? 0.5, oy = o.oy ?? 0.5, z = this.snap;
      x = Math.round((x - sw * ox) * z) / z + sw * ox;
      y = Math.round((y - sh * oy) * z) / z + sh * oy;
    }
    d[k] = x; d[k + 1] = y; d[k + 2] = sw; d[k + 3] = sh;
    d[k + 4] = o.rot ?? 0; d[k + 5] = o.ox ?? 0.5; d[k + 6] = o.oy ?? 0.5;
    d[k + 7] = u0; d[k + 8] = v0; d[k + 9] = u1; d[k + 10] = v1;
    const c = o.color ?? 0xffffffff;
    // bytes in memory must be R,G,B,A: little endian wants 0xAABBGGRR
    this.u32[k + 11] = (((c & 0xff) << 24) | (((c >>> 8) & 0xff) << 16) | (((c >>> 16) & 0xff) << 8) | (c >>> 24)) >>> 0;
    d[k + 12] = 0;
    this.stats.sprites++;
  }

  /** Solid rectangle; top-left anchored. */
  rect(x        , y        , w        , h        , color        , rot = 0)       {
    this.draw(this.white, x, y, w, h, { color, ox: 0, oy: 0, rot });
  }

  /** Width in pixels of a string at a given size. */
  measure(text        , size        )         {
    const s = size / this.font.size;
    let w = 0;
    for (const ch of text) w += ((this.font.glyphs.get(ch) ?? this.font.glyphs.get("?") ).w - 4) * s;
    return w;
  }

  /** Text with its top-left at (x, y). align: 0 left, 0.5 centre, 1 right. */
  text(text        , x        , y        , size = 16, color = 0xffffffff, align = 0)       {
    const F = this.font, s = size / F.size;
    let cx = x - this.measure(text, size) * align;
    for (const ch of text) {
      const g = F.glyphs.get(ch) ?? F.glyphs.get("?") ;
      if (ch !== " ") this.draw({ tex: F.tex, x: g.x, y: 0, w: g.w, h: F.h }, cx - 2 * s, y, g.w * s, F.h * s, { color, ox: 0, oy: 0 });
      cx += (g.w - 4) * s;
    }
  }

  flush()       {
    if (!this.n || !this.cur) return;
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.uProj, false, this.proj);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const bytes = this.n * FLOATS * 4;
    if (bytes > this.cap) this.cap = Math.max(bytes, this.cap * 2);
    gl.bufferData(gl.ARRAY_BUFFER, this.cap, gl.STREAM_DRAW);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data.subarray(0, this.n * FLOATS));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.cur.tex);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.n);
    this.stats.draws++;
    this.n = 0;
  }

  end()       {
    this.flush();
    const gl = this.gl;
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
  }
}
