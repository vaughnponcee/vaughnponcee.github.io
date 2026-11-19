/**
 * The deterministic game rules shared by server and client. Prediction only
 * works if both sides run *exactly* this code with the same inputs.
 */
export const TICK_HZ = 30;
export const DT = 1 / TICK_HZ;
export const SPEED = 220;            // px / s
export const ARENA = { w: 800, h: 500 };
export const RADIUS = 14;

                                                     
                                                                 // dx, dy in [-1, 1]

/** Pure: returns the next state. Diagonal movement is normalized. */
export function applyInput(s             , inp       , dt = DT)              {
  let { dx, dy } = inp;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) dx = dy = 0;   // never trust the wire
  dx = Math.max(-1, Math.min(1, dx));
  dy = Math.max(-1, Math.min(1, dy));
  const len = Math.hypot(dx, dy);
  if (len > 1) { dx /= len; dy /= len; }
  // round to 1/1000 px so float drift can't make client and server diverge
  const x = Math.round(Math.max(RADIUS, Math.min(ARENA.w - RADIUS, s.x + dx * SPEED * dt)) * 1000) / 1000;
  const y = Math.round(Math.max(RADIUS, Math.min(ARENA.h - RADIUS, s.y + dy * SPEED * dt)) * 1000) / 1000;
  return { x, y };
}

export function spawnPoint(id        )              {
  const a = (id * 2.399963) % (Math.PI * 2);   // golden-angle spread
  return { x: ARENA.w / 2 + Math.cos(a) * 150, y: ARENA.h / 2 + Math.sin(a) * 120 };
}
