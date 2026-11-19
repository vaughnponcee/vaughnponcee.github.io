/**
 * Asset library and sprite animation.
 *
 * A SpriteAsset is pixel art made in the editor's sprite painter: a size, a
 * palette-free RGBA frame list, and named animations (frame ranges + fps).
 * Assets are plain JSON, so they live in localStorage, export to files, and
 * load in games without an image pipeline.
 */
                                                                
import { Project } from "./project.js?v=122c782b";

                                                                                                  

                              
                 
               
            
            
                                                       
                   
                      
 

export const LIBRARY_KEY = "ember.assets";

const spritePath = (name        ) => `sprites/${name.replace(/[^\w .-]/g, "_")}.json`;
// painting saves on every stroke: coalesce disk writes per sprite
const pending = new Map                                       ();
function queueWrite(a             ) {
  const p = Project.store;
  if (!p) return;
  clearTimeout(pending.get(a.name));
  pending.set(a.name, setTimeout(() => { pending.delete(a.name); void p.write(spritePath(a.name), JSON.stringify(a)); }, 400));
}

export function encodePixels(px                   )         {
  let s = "";
  for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode(...px.subarray(i, i + 0x8000));
  return btoa(s);
}

export function decodePixels(b64        , w        , h        )                    {
  const s = atob(b64), out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < out.length && i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function blankFrame(w        , h        )         {
  return encodePixels(new Uint8ClampedArray(w * h * 4));
}

/** Pack every frame side by side into one canvas (a sprite sheet). */
export function sheetCanvas(a             )                    {
  const c = document.createElement("canvas");
  c.width = a.w * Math.max(1, a.frames.length);
  c.height = a.h;
  const g = c.getContext("2d") ;
  a.frames.forEach((f, i) => g.putImageData(new ImageData(decodePixels(f, a.w, a.h), a.w, a.h), i * a.w, 0));
  return c;
}

                                                                                   

export function loadSprite(sb             , a             )               {
  const tex = sb.texture(sheetCanvas(a), true);
  return { asset: a, tex, frames: a.frames.map((_, i) => ({ tex, x: i * a.w, y: 0, w: a.w, h: a.h })) };
}

/** Plays one named animation of a sprite; call update(dt) and draw frame(). */
export class Animator {
           sprite              ;
  anim            ;
  time = 0;
  done = false;

  constructor(sprite              , name         ) {
    this.sprite = sprite;
    this.anim = this.find(name);
  }

          find(name         )             {
    const a = this.sprite.asset;
    return a.anims.find((x) => x.name === name) ?? a.anims[0] ?? { name: "all", from: 0, to: a.frames.length - 1, fps: 8, loop: true };
  }

  /** Switch animation; restarts only if it is a different one. */
  play(name        )       {
    if (this.anim.name === name) return;
    this.anim = this.find(name);
    this.time = 0;
    this.done = false;
  }

  update(dt        )       { this.time += dt; }

  index()         {
    const { from, to, fps, loop } = this.anim;
    const n = Math.max(1, to - from + 1);
    let k = Math.floor(this.time * fps);
    if (loop) k %= n;
    else if (k >= n) { k = n - 1; this.done = true; }
    return from + k;
  }

  frame()        { return this.sprite.frames[Math.min(this.index(), this.sprite.frames.length - 1)]; }
}

/** Browser asset library backed by localStorage. */
export const Library = {
  all()                {
    try { return JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? "[]"); } catch { return []; }
  },
  get(name        )                          { return this.all().find((a) => a.name === name); },
  save(a             )       {
    const list = this.all().filter((x) => x.name !== a.name);
    list.push(a);
    try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(list)); } catch { /* storage full or blocked */ }
    queueWrite(a);
  },
  remove(name        )       {
    try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(this.all().filter((x) => x.name !== name))); } catch { /* ignore */ }
    void Project.store?.remove(spritePath(name));
  },
  /**
   * After connecting a project: sprites on disk win over browser copies, and
   * sprites that only exist in the browser are written to disk.
   */
  async syncFromProject()                  {
    const p = Project.store;
    if (!p) return 0;
    const byName = new Map(this.all().map((a) => [a.name, a]));
    const onDisk = new Set        ();
    for (const f of await p.list("sprites")) {
      if (!f.endsWith(".json")) continue;
      try {
        const a = JSON.parse((await p.read("sprites/" + f)) ?? "")               ;
        if (a.kind === "sprite" && a.frames?.length) { byName.set(a.name, a); onDisk.add(a.name); }
      } catch { /* skip broken files */ }
    }
    try { localStorage.setItem(LIBRARY_KEY, JSON.stringify([...byName.values()])); } catch { /* ignore */ }
    for (const a of byName.values()) if (!onDisk.has(a.name)) await p.write(spritePath(a.name), JSON.stringify(a));
    return byName.size;
  },
};
