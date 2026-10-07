import { randomUUID, createHash } from "node:crypto";

export function newId(prefix?: string): string {
  const id = randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Stable hash — used to make deterministic generators reproducible. */
export function stableHash(input: string): number {
  const h = createHash("sha256").update(input).digest();
  return h.readUInt32BE(0);
}

/** Deterministic PRNG seeded from a string, so demo output is reproducible. */
export function seededRandom(seed: string): () => number {
  let s = stableHash(seed) || 1;
  return () => {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}
