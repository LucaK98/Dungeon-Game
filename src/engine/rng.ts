/** Random source. Seedable so tests and replays are reproducible. */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max]. */
  int(min: number, max: number): number;
}

/** Mulberry32: small, fast, good enough for dice. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (min, max) => min + Math.floor(next() * (max - min + 1)) };
}

export function randomRng(): Rng {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return seededRng(buf[0]!);
}

/** Replays fixed values (for tests). Falls back to `fallback` when exhausted. */
export function scriptedRng(dice: number[], fallback: Rng = seededRng(1)): Rng {
  const queue = [...dice];
  return {
    next: () => fallback.next(),
    int: (min, max) => {
      const v = queue.shift();
      if (v === undefined) return fallback.int(min, max);
      if (v < min || v > max) throw new Error(`scripted value ${v} outside ${min}..${max}`);
      return v;
    },
  };
}
