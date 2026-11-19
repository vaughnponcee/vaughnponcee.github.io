/** Wire messages (JSON text frames). */
                                      

                                                                               
                           
            
                                                               
                                                                                       
                                                                                 
                                                  
 
                           
             
                                                                         
                                                     
                  
 
                                              
                                                         

                                                
                                        

const MAX_INPUTS_PER_MSG = 8;

export function encode(m                       )         {
  return JSON.stringify(m);
}

/** Validates shape; returns null for anything malformed (never throws on wire data). */
export function decodeClient(raw        )                   {
  let m         ;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!m || typeof m !== "object") return null;
  const o = m                           ;
  if (o.t === "ping" && typeof o.c === "number") return { t: "ping", c: o.c };
  if (o.t === "input" && Array.isArray(o.inputs) && o.inputs.length <= MAX_INPUTS_PER_MSG) {
    const inputs          = [];
    for (const i of o.inputs                             ) {
      if (!i || !Number.isInteger(i.seq) || typeof i.dx !== "number" || typeof i.dy !== "number") return null;
      inputs.push({ seq: i.seq          , dx: i.dx          , dy: i.dy           });
    }
    return { t: "input", inputs };
  }
  return null;
}

export function decodeServer(raw        )                   {
  try {
    const m = JSON.parse(raw);
    return m && typeof m.t === "string" ? (m             ) : null;
  } catch {
    return null;
  }
}
