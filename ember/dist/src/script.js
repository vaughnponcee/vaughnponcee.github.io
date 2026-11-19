/**
 * Scripting: attach behaviour to scene objects, Unity-style.
 *
 * A script is JavaScript source stored in the scene. It defines lifecycle
 * functions that the engine calls with a handle to the object it is attached
 * to (`self`) and the engine API (`game`):
 *
 *   function start(self, game) { self.state.speed = 4; }
 *   function update(self, game, dt) {
 *     const m = game.input.axes();
 *     self.velocity = [m.x * self.state.speed, self.velocity[1], -m.y * self.state.speed];
 *     if (game.input.pressed("Space") && self.grounded) self.velocity[1] = 9;
 *   }
 *   function onTrigger(self, other, game) {
 *     if (other.tag === "coin") { other.destroy(); game.state.score++; game.sound.pickup(); }
 *   }
 *
 * Scripts run in the page with the engine API in scope; they are your own
 * game code, not untrusted input.
 */
                                              
                                                       
                                                      
                                        
                                      
                                          
import {                                                              spawnObject, S, T, M, B } from "./scene.js";
                                      

                              
                                                  
                                                               
                                                                           
                                                                           
                                                      
 

                                                                                

/** What scripts see for a scene object. */
export class ObjectHandle {
  /** Per-object storage for your script's variables. */
  state                          = {};
           entity        ;
          rt               ;

  constructor(rt               , e        ) { this.rt = rt; this.entity = e; }

          get src() { return this.rt.world.store             (S).get(this.entity); }
          get tr() { return this.rt.world.store           (T).get(this.entity); }
          get body() { return this.rt.world.store      (B).get(this.entity); }

  get alive()          { return this.rt.world.alive(this.entity); }
  get name()         { return this.src?.name ?? ""; }
  get tag()         { return this.src?.tag ?? ""; }

  get position()       { return this.body?.pos ?? this.tr?.pos ?? [0, 0, 0]; }
  set position(p      ) {
    const b = this.body, t = this.tr;
    if (b) { b.pos = [...p]        ; b.sleeping = false; }
    if (t) { t.pos = [...p]        ; t.prev = [...p]        ; }
  }
  get velocity()       { return this.body?.vel ?? [0, 0, 0]; }
  set velocity(v      ) { const b = this.body; if (b) { b.vel = [...v]        ; b.sleeping = false; } }
  /** True when resting on something (dynamic bodies only). */
  get grounded()          { return !!this.body?.grounded; }
  get rotation()         { return this.tr?.yaw ?? 0; }
  set rotation(y        ) { const t = this.tr; if (t) t.yaw = y; }
  get scale()       { return this.tr?.size ?? [1, 1, 1]; }
  set scale(s      ) { const t = this.tr; if (t) t.size = [...s]        ; }
  get color()       { return this.rt.world.store       (M).get(this.entity)?.color ?? [1, 1, 1]; }
  set color(c      ) { const m = this.rt.world.store       (M).get(this.entity); if (m) m.color = [...c]        ; }
  get visible()          { return this.rt.world.store       (M).has(this.entity); }

  /** Add an instant change in velocity. */
  push(v      )       { const b = this.body; if (b) { b.vel[0] += v[0]; b.vel[1] += v[1]; b.vel[2] += v[2]; b.sleeping = false; } }
  destroy()       { this.rt.destroy(this.entity); }
  distanceTo(o              )         { const a = this.position, b = o.position; return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
}

/** The engine API given to every script as `game`. */
                          
               
             
                 
                                    
               
                                                              
                                 
                                          
                                       
                                                                                     
                                                                                                                      
                                                              
                                                                             
                                        
                            
                                
 

export class ScriptRuntime {
           world       ;
           phys              ;
           R          ;
           meshes                        ;
           sources                        ;
           api         ;
  errors                = [];
  follow                                                                 = null;
  printed           = [];
  logs           = [];

          compiled = new Map                            ();
          attached = new Map                                                                                      ();
          handles = new Map                      ();

  constructor(world       , phys              , R          , meshes                        , sources                        , input       , sound     , camera        ) {
    this.world = world; this.phys = phys; this.R = R; this.meshes = meshes; this.sources = sources;
    const rt = this;
    this.api = {
      input, sound, camera, time: 0, state: {},
      find: (name) => {
        const src = world.store             (S);
        for (let i = 0; i < src.size; i++) if (src.dense[i].name === name) return rt.handle(src.entities[i]);
        return null;
      },
      findAll: (tag) => {
        const src = world.store             (S), out                 = [];
        for (let i = 0; i < src.size; i++) if (src.dense[i].tag === tag) out.push(rt.handle(src.entities[i]));
        return out;
      },
      spawn: (o, script) => {
        const full              = { name: o.mesh, pos: [0, 0, 0], size: [1, 1, 1], color: [0.8, 0.8, 0.8], body: "dynamic", ...o, script: script ?? o.script };
        const e = spawnObject(full, world, phys, R, meshes);
        rt.attach(e, full);
        return rt.handle(e);
      },
      raycast: (from, dir, max = 100) => {
        const h = phys.raycast(from, dir, max);
        if (!h) return null;
        const e = h.body.user                      ;
        return { object: e !== undefined && world.alive(e) ? rt.handle(e) : null, point: h.point, distance: h.t };
      },
      follow: (obj, distance = 9, height = 4) => { rt.follow = obj ? { obj, distance, height } : null; },
      print: (t) => { rt.printed.push(String(t)); },
      log: (...a) => { rt.logs.push(a.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" ")); if (rt.logs.length > 200) rt.logs.shift(); },
    };
  }

  handle(e        )               {
    let h = this.handles.get(e);
    if (!h) { h = new ObjectHandle(this, e); this.handles.set(e, h); }
    return h;
  }

  /** Compile a script by name once. Syntax errors are reported, not thrown. */
          compile(name        )                     {
    if (this.compiled.has(name)) return this.compiled.get(name) ;
    const code = this.sources[name];
    let hooks                     = null;
    if (code === undefined) this.errors.push({ script: name, object: "", message: `script "${name}" does not exist` });
    else {
      try {
        // the script declares plain functions; collect the ones it defined
        const factory = new Function(`"use strict";\n${code}\n;return {` +
          ["start", "update", "onTrigger", "onCollide", "onDestroy"].map((k) => `${k}: typeof ${k} === "function" ? ${k} : undefined`).join(",") + "};");
        hooks = factory()               ;
      } catch (err) {
        this.errors.push({ script: name, object: "", message: (err         ).message });
      }
    }
    this.compiled.set(name, hooks);
    return hooks;
  }

  attach(e        , o             )       {
    if (!o.script) return;
    const hooks = this.compile(o.script);
    if (hooks) this.attached.set(e, { hooks, name: o.script, handle: this.handle(e), started: false });
  }

  attachAll()       {
    const src = this.world.store             (S);
    for (let i = 0; i < src.size; i++) this.attach(src.entities[i], src.dense[i]);
  }

          call(e        , fn            ) {
    try { fn(); } catch (err) {
      const a = this.attached.get(e);
      this.errors.push({ script: a?.name ?? "?", object: a?.handle.name ?? "?", message: (err         ).message });
      this.attached.delete(e); // stop a broken script instead of spamming the same error every frame
    }
  }

  destroy(e        )       {
    if (!this.world.alive(e)) return;
    const a = this.attached.get(e);
    if (a?.hooks.onDestroy) this.call(e, () => a.hooks.onDestroy (a.handle, this.api));
    const b = this.world.store      (B).get(e);
    if (b) this.phys.remove(b);
    const light = this.world.store                    ("light").get(e);
    if (light) light.radius = 0;
    this.attached.delete(e);
    this.world.destroyLater(e);
  }

  /** Run start (first time) and update for every scripted object. */
  update(dt        )       {
    this.api.time += dt;
    for (const [e, a] of [...this.attached]) {
      if (!this.world.alive(e)) { this.attached.delete(e); continue; }
      if (!a.started) { a.started = true; if (a.hooks.start) this.call(e, () => a.hooks.start (a.handle, this.api)); }
      if (a.hooks.update && this.attached.has(e)) this.call(e, () => a.hooks.update (a.handle, this.api, dt));
    }
  }

  /** Deliver this step's trigger overlaps and collisions to scripts. */
  dispatch(contacts                        )       {
    const send = (pairs                        , kind                           ) => {
      for (const c of pairs) {
        const ea = c.a.user                      , eb = c.b.user                      ;
        if (ea === undefined || eb === undefined) continue;
        for (const [self, other] of [[ea, eb], [eb, ea]]         ) {
          const s = this.attached.get(self);
          const fn = s?.hooks[kind];
          if (fn && this.world.alive(self) && this.world.alive(other)) this.call(self, () => fn(s.handle, this.handle(other), this.api));
        }
      }
    };
    send(this.phys.triggerEvents, "onTrigger");
    send(contacts, "onCollide");
  }
}
