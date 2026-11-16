// Deterministic random numbers. Every staged scene and every bot decision that
// must repeat for a screenshot runs through one seeded generator, so the same
// seed stages the same frame. Live play seeds from the clock instead.
export function mulberry32(initial) {
  let a = initial | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function range(random, lo, hi) {
  return lo + random() * (hi - lo);
}

export function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

export function chance(random, p) {
  return random() < p;
}
