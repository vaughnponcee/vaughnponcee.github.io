/**
 * Engine: wires renderer, 2D batch, physics, ECS, input, audio and the fixed
 * loop together so a game only writes its own logic.
 *
 *   const eng = new Engine(canvas);
 *   eng.run({
 *     fixedUpdate(dt) { ...game logic at 60 Hz... },
 *     draw3d(alpha)   { ...queue models (or use the scene system)... },
 *     draw2d(sb, w, h){ ...HUD in screen pixels... },
 *   });
 *
 * F3 toggles a performance overlay. The tab being hidden pauses the loop.
 */
import { World } from "./ecs.js";
import { PhysicsWorld } from "./physics.js";
import { Renderer,                        } from "./renderer.js";
import { SpriteBatch } from "./sprites.js";
import { FixedLoop } from "./loop.js";
import { Input } from "./input.js";
import { Sfx } from "./audio.js";
import { box, cylinder, gem, plane, sphere } from "./mesh.js";
                                           

                       
                                 
                                                 
                                           
                                                                          
                               
                                                                
 

export class Engine {
           canvas                   ;
           renderer          ;
           sprites             ;
           physics = new PhysicsWorld();
           world = new World();
           input       ;
           sfx = new Sfx();
           loop = new FixedLoop(1 / 60);
           meshes                        ;
  camera         = { pos: [0, 8, 14], target: [0, 0, 0], fov: (60 * Math.PI) / 180, near: 0.1, far: 300 };
  /** Run physics.step automatically each fixed step. */
  autoPhysics = true;
  showStats = false;
  time = 0;
  frameMs = 0;
  fps = 0;
  /** Set true in benchmarks: feeds exact 1/60 s per frame. */
  deterministic = false;
  /** Max device pixel ratio; lower it to trade sharpness for fill rate. */
  maxDpr = 2;

          last = 0;
          fpsAcc = 0;
          fpsN = 0;
          running = false;
          worst = 0;
          worstShown = 0;

  constructor(canvas                   ) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.sprites = new SpriteBatch(this.renderer.gl);
    this.input = new Input(canvas);
    this.meshes = {
      box: this.renderer.createMesh(box()),
      sphere: this.renderer.createMesh(sphere(24, 16)),
      cylinder: this.renderer.createMesh(cylinder(24)),
      gem: this.renderer.createMesh(gem()),
      plane: this.renderer.createMesh(plane(1)),
    };
    addEventListener("keydown", (e) => { if (e.code === "F3") { this.showStats = !this.showStats; e.preventDefault(); } });
    addEventListener("pointerdown", () => this.sfx.unlock());
    addEventListener("keydown", () => this.sfx.unlock());
  }

  run(game      )       {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now        ) => {
      const elapsed = this.deterministic ? 1 / 60 : (now - this.last) / 1000;
      this.last = now;
      const t0 = performance.now();
      this.resize();
      const alpha = this.loop.advance(elapsed, (dt) => {
        game.fixedUpdate?.(dt);
        if (this.autoPhysics) this.physics.step(dt);
        this.world.flush();
        this.time += dt;
      });
      game.update?.(Math.min(elapsed, 0.1), alpha);

      const gl = this.renderer.gl;
      const w = this.canvas.width, h = this.canvas.height;
      if (game.draw3d) {
        this.renderer.begin(this.camera);
        game.draw3d(alpha);
        this.renderer.end(this.camera, this.time);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, w, h);
        gl.clearColor(0.06, 0.07, 0.09, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      }
      const cssW = this.canvas.clientWidth, cssH = this.canvas.clientHeight;
      if (game.draw2d || this.showStats) {
        // 2D works in CSS pixels; the projection maps them onto the device-pixel canvas
        this.sprites.resetStats();
        this.sprites.begin(cssW, cssH);
        if (game.draw2d) {
          game.draw2d(this.sprites, cssW, cssH);
        }
        if (this.showStats) this.drawStats(cssW);
        this.sprites.end();
      }
      this.frameMs = performance.now() - t0;
      this.worst = Math.max(this.worst, this.frameMs);
      this.fpsAcc += elapsed;
      this.fpsN++;
      if (this.fpsAcc >= 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; this.worstShown = this.worst; this.worst = 0; }
      this.input.endFrame();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

          drawStats(w        ) {
    const sb = this.sprites, R = this.renderer.stats, P = this.physics.stats;
    const lines = [
      `${this.fps.toFixed(0)} fps   cpu ${this.frameMs.toFixed(2)} ms (worst ${this.worstShown.toFixed(1)})`,
      `3d: ${R.draws} draws, ${R.instances} instances, ${R.culled} culled`,
      `2d: ${sb.stats.sprites} sprites, ${sb.stats.draws} draws`,
      `physics: ${this.physics.bodies.length} bodies, ${P.contacts} contacts, ${P.sleeping} asleep`,
      `entities: ${this.world.count}`,
    ];
    const x = w - 330;
    sb.rect(x - 10, 8, 330, lines.length * 18 + 12, 0x000000b0);
    lines.forEach((l, i) => sb.text(l, x, 14 + i * 18, 13, 0xd8f0d8ff));
  }

  resize()       {
    const dpr = Math.min(devicePixelRatio || 1, this.maxDpr);
    const w = Math.round(this.canvas.clientWidth * dpr), h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }
}
