/**
 * Scene format shared by the editor and games: plain JSON, so scenes can be
 * saved, diffed and loaded at runtime.
 *
 * spawnScene() turns a scene into ECS entities with Transform, Model and
 * (optionally) a physics Body. syncAndDraw() is the standard render system.
 */
                                              
                                                       
                                                                
import {            fromTRS, lerp, quatFromEuler } from "./math.js";
import { fromBase64, parseModel } from "./gltf.js";

                                                                                           
                                                                 

                              
               
                 
            
             
               
              
                    
                 
                    
                  
                
                  
                    
                                                                  
                    
                                                                 
               
                                          
                                                     
                  
 

                        
             
               
             
                 
                
               
                                                                      
                                   
                                                                                     
                                  
                         
 

                                                                             
                                                                                                     

/** Component names used by the built-in systems. */
export const T = "transform", M = "model", B = "body", S = "source", L = "light";

/** Upload any scene models that aren't in the mesh table yet. Bad models are skipped and reported. */
export function loadModels(scene       , R          , meshes                      )           {
  const errors           = [];
  for (const [name, data] of Object.entries(scene.models ?? {})) {
    const key = `model:${name}`;
    if (meshes[key]) continue;
    try { meshes[key] = R.createMesh(parseModel(fromBase64(data)).mesh); }
    catch (e) { errors.push(`${name}: ${(e         ).message}`); }
  }
  return errors;
}

export function spawnObject(o             , world       , phys              , R          , meshes                      )         {
  const e = world.spawn();
  world.store             (S).set(e, o);
  world.store           (T).set(e, { pos: [...o.pos]        , prev: [...o.pos]        , size: [...o.size]        , yaw: o.yaw ?? 0 });
  world.store       (M).set(e, { mesh: meshes[o.mesh] ?? meshes.box, color: o.color, emissive: o.emissive ?? 0, rough: o.rough ?? 0.6, checker: !!o.checker });
  const kind = o.body ?? "static";
  if (kind !== "none") {
    const sphere = o.mesh === "sphere" || o.mesh === "gem";
    const shape = sphere
      ? { kind: "sphere"         , r: Math.max(o.size[0], o.size[1], o.size[2]) / 2 }
      : { kind: "box"         , half: [o.size[0] / 2, (o.mesh === "plane" ? 0.05 : o.size[1] / 2), o.size[2] / 2]         };
    const body = phys.add({
      pos: o.pos, shape, user: e, rot: quatFromEuler(o.yaw ?? 0),
      mass: kind === "dynamic" ? (o.mass ?? 1) : 0,
      trigger: kind === "trigger",
      restitution: o.bounce ?? 0.1,
      friction: o.friction ?? 0.6,
      fixedRotation: !!o.upright,
    });
    world.store      (B).set(e, body);
  }
  if (o.light) {
    const l             = { pos: [...o.pos]        , color: o.light.color, radius: o.light.radius };
    R.lights.push(l);
    world.store            (L).set(e, l);
  }
  return e;
}

export function spawnScene(scene       , world       , phys              , R          , meshes                      )                      {
  loadModels(scene, R, meshes);
  if (scene.sky) R.sky = scene.sky;
  if (scene.horizon) R.horizon = scene.horizon;
  if (scene.sunDir) { const d = scene.sunDir, l = Math.hypot(...d); R.sunDir = [d[0] / l, d[1] / l, d[2] / l]; }
  if (scene.fog !== undefined) R.fogDensity = scene.fog;
  const byName = new Map                ();
  for (const o of scene.objects) byName.set(o.name, spawnObject(o, world, phys, R, meshes));
  return byName;
}

/** Call at the start of each fixed step so rendering can interpolate. */
export function savePrevious(world       )       {
  const ts = world.store           (T), bs = world.store      (B);
  for (let i = 0; i < bs.size; i++) {
    const e = bs.entities[i], t = ts.get(e);
    if (t) { const p = bs.dense[i].pos; t.prev[0] = p[0]; t.prev[1] = p[1]; t.prev[2] = p[2]; }
  }
}

/** Copy physics positions into transforms, move lights, and queue every model. */
export function syncAndDraw(world       , R          , alpha        , model = new Float32Array(16))       {
  const ts = world.store           (T), ms = world.store       (M), bs = world.store      (B), ls = world.store            (L);
  for (let i = 0; i < ms.size; i++) {
    const e = ms.entities[i], m = ms.dense[i], t = ts.get(e);
    if (!t) continue;
    const b = bs.get(e);
    if (b) { t.pos[0] = b.pos[0]; t.pos[1] = b.pos[1]; t.pos[2] = b.pos[2]; }
    const moving = b && b.invMass > 0;
    const px = moving ? lerp(t.prev[0], t.pos[0], alpha) : t.pos[0];
    const py = moving ? lerp(t.prev[1], t.pos[1], alpha) : t.pos[1];
    const pz = moving ? lerp(t.prev[2], t.pos[2], alpha) : t.pos[2];
    // moving bodies use their simulated orientation; everything else uses yaw
    fromTRS([px, py, pz], moving ? b.rot : quatFromEuler(t.yaw), t.size, model);
    R.draw(m.mesh, model, m.color, { emissive: m.emissive, rough: m.rough, checker: m.checker, shadow: m.emissive === 0 });
    const l = ls.get(e);
    if (l) { l.pos[0] = px; l.pos[1] = py; l.pos[2] = pz; }
  }
}

/** Current state of every entity that came from a scene, as a new Scene. */
export function serializeScene(world       , base                        )        {
  const src = world.store             (S), ts = world.store           (T), ms = world.store       (M);
  const objects                = [];
  for (let i = 0; i < src.size; i++) {
    const e = src.entities[i], o = src.dense[i], t = ts.get(e), m = ms.get(e);
    objects.push({ ...o, pos: t ? [...t.pos]         : o.pos, size: t ? [...t.size]         : o.size, yaw: t?.yaw ?? o.yaw, color: m ? [...m.color]         : o.color });
  }
  return { ...base, objects };
}
