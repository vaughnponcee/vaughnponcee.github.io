/**
 * Scripts tab of the editor: list, edit and attach scripts, live syntax
 * check, and the play-mode console.
 */
                                             
                                                      

               
                    
                        
                  
                     
                      
 

const TEMPLATE = (name        ) => `// ${name}
// self: the object this script is attached to. game: the engine API.

function start(self, game) {
}

function update(self, game, dt) {
}

function onTrigger(self, other, game) {
}
`;

export function setupScriptsTab(ctx     ) {
  const $ =                        (id        ) => document.getElementById(id)     ;
  const list = $("scripts"), code = $                     ("code");
  let current = "";

  function render() {
    const scene = ctx.getScene();
    scene.scripts ??= {};
    const names = Object.keys(scene.scripts);
    if (!names.includes(current)) current = names[0] ?? "";
    list.innerHTML = "";
    for (const n of names) {
      const li = document.createElement("li");
      li.className = n === current ? "sel" : "";
      const users = scene.objects.filter((o) => o.script === n).length;
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = n;
      const k = document.createElement("span");
      k.className = "kind";
      k.textContent = `${users} ${users === 1 ? "object" : "objects"}`;
      li.append(nm, k);
      li.onclick = () => { current = n; render(); };
      list.appendChild(li);
    }
    code.value = current ? scene.scripts[current] : "";
    code.disabled = !current;
    $("script-name").textContent = current || "no script";
    check();
  }

  function check() {
    const out = $("syntax");
    if (!current) { out.textContent = ""; return; }
    try { new Function(code.value); out.textContent = "No syntax errors"; out.className = "ok"; }
    catch (e) { out.textContent = (e         ).message; out.className = "bad"; }
  }

  let timer = 0;
  code.addEventListener("input", () => {
    if (!current) return;
    ctx.getScene().scripts [current] = code.value;
    clearTimeout(timer);
    timer = setTimeout(() => { ctx.persist(); check(); }, 300)                     ;
  });
  code.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    e.preventDefault(); // indent instead of leaving the editor
    const s = code.selectionStart, t = code.selectionEnd;
    code.value = code.value.slice(0, s) + "  " + code.value.slice(t);
    code.selectionStart = code.selectionEnd = s + 2;
    code.dispatchEvent(new Event("input"));
  });

  $("sc-new").onclick = () => {
    const scene = ctx.getScene();
    const name = prompt("Script name", "script" + (Object.keys(scene.scripts ?? {}).length + 1))?.trim();
    if (!name) return;
    scene.scripts ??= {};
    if (scene.scripts[name] !== undefined) { alert("A script with that name already exists."); return; }
    scene.scripts[name] = TEMPLATE(name);
    current = name;
    ctx.persist(); render(); ctx.afterChange();
  };
  $("sc-del").onclick = () => {
    const scene = ctx.getScene();
    if (!current || !confirm(`Delete script "${current}"? Objects using it lose it.`)) return;
    ctx.checkpoint();
    delete scene.scripts [current];
    for (const o of scene.objects) if (o.script === current) delete o.script;
    ctx.persist(); render(); ctx.afterChange();
  };
  $("sc-attach").onclick = () => {
    const scene = ctx.getScene(), sel = ctx.getSelected();
    if (sel < 0 || !current) { alert("Select an object in the Scene tab first."); return; }
    ctx.checkpoint();
    scene.objects[sel].script = current;
    ctx.persist(); render(); ctx.afterChange();
  };

  function showConsole(rt               ) {
    const lines = [
      ...rt.errors.map((e) => `error in ${e.script}${e.object ? ` (${e.object})` : ""}: ${e.message}`),
      ...rt.logs.slice(-30),
    ];
    const text = lines.join("\n");
    const c = $("console");
    if (c.textContent !== text) c.textContent = text;
    c.classList.toggle("has-error", rt.errors.length > 0);
  }

  return { render, showConsole };
}
