import type { ScoreBreakdownItem } from "@/lib/db/types";
import { clamp } from "@/lib/util/text";

/**
 * A target band for a measured metric.
 *
 * Scoring is band-based rather than "more is better" because almost every
 * thumbnail variable is non-monotonic: saturation below the band reads flat,
 * above it reads cheap; text coverage below the band wastes the format, above
 * it turns the cell into a wall of words at 168px. Bands make that explicit and
 * auditable, which is why every sub-score ships with its own target in the UI.
 */
export type Band = {
  /** Full marks inside [lo, hi]. */
  lo: number;
  hi: number;
  /** Zero marks at or beyond these. */
  hardLo: number;
  hardHi: number;
};

export function band(lo: number, hi: number, hardLo?: number, hardHi?: number): Band {
  const spread = hi - lo;
  return {
    lo,
    hi,
    hardLo: hardLo ?? lo - Math.max(spread * 2, lo * 0.9 || 0.1),
    hardHi: hardHi ?? hi + Math.max(spread * 2, hi * 0.9 || 0.1),
  };
}

/** 0-100 score for a value against a band, with soft linear shoulders. */
export function bandScore(value: number, b: Band): number {
  if (Number.isNaN(value)) return 50;
  if (value >= b.lo && value <= b.hi) return 100;
  if (value < b.lo) {
    if (value <= b.hardLo) return 0;
    return clamp((value - b.hardLo) / (b.lo - b.hardLo), 0, 1) * 100;
  }
  if (value >= b.hardHi) return 0;
  return clamp((b.hardHi - value) / (b.hardHi - b.hi), 0, 1) * 100;
}

/** Monotonic "higher is better" score with a saturation point. */
export function riseScore(value: number, floor: number, ceiling: number): number {
  if (value <= floor) return 0;
  if (value >= ceiling) return 100;
  return ((value - floor) / (ceiling - floor)) * 100;
}

export function verdictOf(score: number): ScoreBreakdownItem["verdict"] {
  if (score >= 78) return "strong";
  if (score >= 52) return "ok";
  return "weak";
}

export function pct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtBand(b: Band, asPercent = true, digits = 0): string {
  const f = (v: number) => (asPercent ? `${(v * 100).toFixed(digits)}%` : v.toFixed(digits));
  return `${f(b.lo)}–${f(b.hi)}`;
}

/** Weighted mean of sub-scores, 0-100. */
export function weighted(items: { score: number; weight: number }[]): number {
  const total = items.reduce((a, i) => a + i.weight, 0);
  if (total === 0) return 0;
  return items.reduce((a, i) => a + i.score * i.weight, 0) / total;
}

export function makeItem(args: {
  key: string;
  label: string;
  score: number;
  weight: number;
  value: string;
  target: string;
  note: string;
}): ScoreBreakdownItem {
  return {
    key: args.key,
    label: args.label,
    score: Math.round(args.score),
    weight: args.weight,
    value: args.value,
    target: args.target,
    verdict: verdictOf(args.score),
    note: args.note,
  };
}
