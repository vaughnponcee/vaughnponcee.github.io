/**
 * Project storage: where scenes and sprites live as real files.
 *
 * - In the desktop app, the host exposes a small file API for Documents/ember
 *   (the page receives an access token in its URL).
 * - In Chrome or Edge, you can pick any folder with the File System Access API.
 * - Otherwise there is no project: data stays in browser storage (export to keep).
 *
 * Paths are always relative, e.g. "scenes/level1.json" or "sprites/hero.json".
 */
                               
                         
                                       
                                             
                                                   
                                      
 

const TOKEN_KEY = "ember.token";

/** The desktop host's token, from this page's URL or carried over from the launcher. */
export function desktopToken()                {
  const m = /token=([0-9a-f]{32})/.exec(location.hash);
  if (m) { try { sessionStorage.setItem(TOKEN_KEY, m[1]); } catch { /* ignore */ } return m[1]; }
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

class DesktopStore                         {
           label        ;
          token        ;
  constructor(token        , label        ) { this.token = token; this.label = label; }
          req(method        , api        , path        , body         ) {
    return fetch(`/api/${api}?path=${encodeURIComponent(path)}`, { method, body, headers: { "x-ember-token": this.token } });
  }
  async list(dir        ) { const r = await this.req("GET", "list", dir); return r.ok ? (await r.json())             : []; }
  async read(path        ) { const r = await this.req("GET", "file", path); return r.ok ? r.text() : null; }
  async write(path        , text        ) { const r = await this.req("PUT", "file", path, text); if (!r.ok) throw new Error(`save failed (${r.status})`); }
  async remove(path        ) { await this.req("DELETE", "file", path); }
}

                                        
                                            
  

class FolderStore                         {
           label        ;
          root     ;
  constructor(root     ) { this.root = root; this.label = root.name; }
          async dir(parts          , create         )                      {
    let d      = this.root;
    for (const p of parts) {
      try { d = (await d.getDirectoryHandle(p, { create }))       ; } catch { return null; }
    }
    return d;
  }
          split(path        ) {
    const parts = path.split("/").filter((p) => p && p !== "." && p !== "..");
    return { dirs: parts.slice(0, -1), name: parts[parts.length - 1] ?? "" };
  }
  async list(dir        ) {
    const d = await this.dir(dir.split("/").filter(Boolean), false);
    if (!d) return [];
    const out           = [];
    for await (const h of d.values()) if (h.kind === "file") out.push(h.name);
    return out;
  }
  async read(path        ) {
    const { dirs, name } = this.split(path);
    const d = await this.dir(dirs, false);
    try { return d ? await (await (await d.getFileHandle(name)).getFile()).text() : null; } catch { return null; }
  }
  async write(path        , text        ) {
    const { dirs, name } = this.split(path);
    const d = (await this.dir(dirs, true)) ;
    const w = await (await d.getFileHandle(name, { create: true })).createWritable();
    await w.write(text);
    await w.close();
  }
  async remove(path        ) {
    const { dirs, name } = this.split(path);
    const d = await this.dir(dirs, false);
    try { await d?.removeEntry(name); } catch { /* already gone */ }
  }
}

let current                      = null;
const listeners                                       = [];

export const Project = {
  get store()                      { return current; },
  onChange(fn                                  )       { listeners.push(fn); },

  /** Connect to the desktop host if this page was opened by it. */
  async detectDesktop()                   {
    const t = desktopToken();
    if (!t) return false;
    try {
      const r = await fetch("/api/info", { headers: { "x-ember-token": t } });
      if (!r.ok) return false;
      const info = await r.json()                       ;
      this.set(new DesktopStore(t, info.project));
      return true;
    } catch { return false; }
  },

  /** Browser: let the user pick a project folder (Chrome and Edge). */
  async pickFolder()                   {
    const picker = (window                                                                     ).showDirectoryPicker;
    if (!picker) throw new Error("This browser can't open folders. Use Chrome or Edge, or the desktop app.");
    const dir = await picker({ mode: "readwrite", id: "ember-project" });
    this.set(new FolderStore(dir));
    return true;
  },

  set(p                     )       { current = p; for (const l of listeners) l(p); },

  get folderSupported()          { return "showDirectoryPicker" in window; },
};
