/**
 * Moss Ledge: level data and player movement, with no DOM or rendering, so
 * tests can simulate the exact same physics the game runs.
 */
import { Tilemap,           } from "../src/tilemap.js";
import { damp, lerp } from "../src/math.js";

export const TILE = 16;
export const GRAV = 900, RUN = 110, RUN_MULT = 1.45, JUMP = 300, MAX_FALL = 420;
/** Gravity multiplier while rising with the jump key released (short hop). */
export const SHORT_HOP = 2.4;

// Legend: # ground, = one-way plank, ^ spikes, o coin, s slime, C checkpoint, P start, F flag.
// Design rule: a ledge is at most 3 tiles above where you jump from (full jump peaks
// at about 3.1 tiles); the reachability test in test/moss.test.ts checks every coin.
export const LEVEL = [
  "                                                                                                                                ",
  "                                                                                                                                ",
  "                                                                                                                                ",
  "                                                                        o o o                                                   ",
  "                                                                       =======                                         o o o F  ",
  "                                o o o                                                   o o                          ========== ",
  "                               =======                   o                   ===       =====                ###             ## ",
  "                   o o                      ===          ###           o              =         o           ###     o o       ## ",
  "                  =====               s            o    ###         =====      C     =====    =====    o    ###    =====      ## ",
  "  P                        ####    ######    ===      ===                              s                  ######                ## ",
  "              o           #####    ######                   o o               ######         #####                     o o  ## ",
  "#########   ######   #########^^^#######################  ###########  ######^^^##########^^^#######################   ##########",
  "#########   ######   ###################################  ###########  #################################################   ##########",
  "#########^^^######^^^###################################^^###########^^###########################################^^^##########",
  "################################################################################################################################",
];

                           
                                  
                                 
                                    
                                     
                                          
 

export function buildMap()          {
  const map = Tilemap.fromStrings(LEVEL, TILE, { "#": 2, "=": 4, "^": 5 });
  // grass on exposed dirt, stone below row 13
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (map.get(x, y) === 2 && (y === 0 || map.get(x, y - 1) === 0)) map.set(x, y, 1);
  for (let y = 13; y < map.h; y++) for (let x = 0; x < map.w; x++) if (map.get(x, y) === 2) map.set(x, y, 3);
  map.solid = new Set([1, 2, 3]);
  map.oneWay = new Set([4]);
  return map;
}

export function entities()           {
  const e           = { spawn: { x: 0, y: 0 }, goal: { x: 0, y: 0 }, coins: [], slimes: [], checkpoints: [] };
  LEVEL.forEach((row, y) => [...row].forEach((ch, x) => {
    const wx = x * TILE, wy = y * TILE;
    if (ch === "o") e.coins.push({ x: wx + 8, y: wy + 8 });
    if (ch === "s") e.slimes.push({ x: wx + 2, y: wy + 4 });
    if (ch === "P") e.spawn = { x: wx + 2, y: wy };
    if (ch === "F") e.goal = { x: wx, y: wy };
    if (ch === "C") e.checkpoints.push({ x: wx, y: wy });
  }));
  return e;
}

                                                                                                                           
                                                                                                             
                                                                                   

/** One fixed step of player movement: run, coyote time, jump buffer, variable jump height. */
export function stepPlayer(P       , c          , map         , dt        )             {
  const target = c.x * RUN * (c.run ? RUN_MULT : 1);
  P.vx = lerp(P.vx, target, damp(P.grounded ? 18 : 8, dt));
  if (Math.abs(c.x) > 0.1) P.face = Math.sign(c.x);
  P.coyote = P.grounded ? 0.1 : Math.max(0, P.coyote - dt);
  P.buffer = c.jumpPressed ? 0.12 : Math.max(0, P.buffer - dt);
  let jumped = false;
  if (P.buffer > 0 && P.coyote > 0) { P.vy = -JUMP; P.buffer = P.coyote = 0; jumped = true; }
  P.vy += GRAV * dt * (P.vy < 0 && !c.jumpHeld ? SHORT_HOP : 1);
  P.vy = Math.min(P.vy, MAX_FALL);
  const wasGrounded = P.grounded, fallSpeed = P.vy;
  const res = map.moveAndCollide(P.b, P.vx * dt, P.vy * dt, c.drop);
  if (res.hitY) P.vy = 0;
  if (res.hitX) P.vx = 0;
  P.grounded = res.onGround || (P.vy >= 0 && map.grounded(P.b) && !c.drop);
  return { jumped, landed: P.grounded && !wasGrounded, fallSpeed };
}
