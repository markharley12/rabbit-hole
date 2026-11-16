// A seeded shuffle, so a screen's order is fixed by a seed kept with its draft: it must not jump
// when the screen re-renders or the app reloads, and a review gets a new seed so the order differs.
// Pure; the only randomness is `newSeed`.

/** Hash a string to a 32-bit seed (FNV-1a). */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32: a small generator, good enough for ordering a few lines. */
function generator(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A short random seed to store with a draft. */
export const newSeed = (random: () => number = Math.random): string => Math.floor(random() * 0xffffffff).toString(36)

/** The items in a pseudo-random order fixed by `seed` (Fisher-Yates); the input is not changed. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items]
  const next = generator(hash(seed))
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
