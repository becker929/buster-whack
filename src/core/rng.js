/*!
 * Seedable PRNG (mulberry32).
 *
 * The core never calls Math.random(); it draws from an rng function held on
 * the state, so a run is reproducible from its seed. Same seed + same dt
 * sequence + same intents => same state.
 */

/**
 * @param {number} seed - any 32-bit-ish integer.
 * @returns {() => number} uniform in [0, 1).
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
