/**
 * Title lexicons.
 *
 * Deliberately small and hand-curated rather than scraped: every entry here is
 * a pattern that changes how a title is read in a search result, and each list
 * is used for a different purpose (a curiosity marker is rewarded, an overclaim
 * marker is penalised, and several words appear in neither because they are
 * merely common).
 */

/** Open-loop markers: they promise information the title withholds. */
export const CURIOSITY_MARKERS = [
  "why", "how", "what happened", "nobody", "no one", "secret", "secrets",
  "actually", "really", "the real", "truth", "hidden", "mistake", "mistakes",
  "until", "before you", "stop", "never", "wish i knew", "i tried", "i spent",
  "what i learned", "turns out", "this is why", "the reason", "that no one",
  "they don't", "they dont", "nobody tells you", "most people", "went wrong",
];

/** Concrete outcome words — the other half of a good hook. */
export const OUTCOME_MARKERS = [
  "in", "days", "day", "weeks", "week", "months", "month", "hours", "hour",
  "minutes", "step", "steps", "guide", "tutorial", "framework", "system",
  "results", "result", "proof", "tested", "review", "vs", "versus", "ranked",
  "tier list", "best", "worst", "cheapest", "fastest", "easiest", "ultimate",
];

/** High-charge words. Used sparingly they lift; stacked they read as spam. */
export const POWER_WORDS = [
  "brutal", "ruthless", "genius", "insane", "unreal", "shocking", "banned",
  "illegal", "dangerous", "broken", "dead", "killed", "exposed", "destroyed",
  "finally", "instantly", "effortless", "painless", "free", "proven", "simple",
  "perfect", "ultimate", "complete", "definitive", "underrated", "overrated",
  "weird", "strange", "forbidden", "unbelievable", "legendary", "elite",
];

/** Overclaim markers: short-term CTR, long-term trust damage. */
export const OVERCLAIM_MARKERS = [
  "you won't believe", "you wont believe", "gone wrong", "gone sexual",
  "shocking truth", "will blow your mind", "doctors hate", "this one weird",
  "100% guaranteed", "guaranteed", "miracle", "overnight", "get rich quick",
  "no one knows", "literally everyone", "changed my life forever",
];

/** Negative-valence framing. Strong CTR in most niches, fatiguing if overused. */
export const NEGATIVE_FRAMES = [
  "mistake", "mistakes", "wrong", "fail", "failed", "failing", "stop", "never",
  "avoid", "worst", "quit", "problem", "trap", "scam", "lie", "lies", "myth",
  "dont", "don't", "warning", "danger", "risk", "regret",
];

export const NUMBER_RE = /(?:^|\s|[£$€])\d[\d,.]*\s*(?:k|m|bn|%|x)?/i;
export const BRACKET_RE = /[[\](){}|]|—|–/;
export const TIMEFRAME_RE =
  /\b\d+\s*(?:second|sec|minute|min|hour|hr|day|week|month|year|yr)s?\b/i;

export function countMatches(haystack: string, needles: string[]): string[] {
  const lower = ` ${haystack.toLowerCase()} `;
  return needles.filter((n) =>
    n.includes(" ") ? lower.includes(` ${n} `) || lower.includes(`${n}`) : new RegExp(`\\b${n}\\b`, "i").test(lower),
  );
}

/** Hook archetypes used when generating and labelling title variants. */
export const TITLE_ARCHETYPES = [
  { id: "curiosity-gap", label: "Curiosity gap", pattern: "Why <subject> <surprising outcome>" },
  { id: "number-outcome", label: "Number + outcome", pattern: "<N> <things> that <outcome>" },
  { id: "transformation", label: "Transformation", pattern: "<before> → <after> in <timeframe>" },
  { id: "mistake-warning", label: "Mistake / warning", pattern: "Stop <common action> (do this instead)" },
  { id: "authority-proof", label: "Authority + proof", pattern: "I <did X> for <timeframe>. Here's what happened" },
  { id: "versus", label: "Head-to-head", pattern: "<A> vs <B>: the honest answer" },
  { id: "contrarian", label: "Contrarian", pattern: "<popular belief> is wrong. Here's why" },
  { id: "speed-promise", label: "Speed promise", pattern: "<outcome> in <short timeframe>" },
  { id: "insider", label: "Insider access", pattern: "What <group> won't tell you about <subject>" },
  { id: "listicle-rank", label: "Ranked list", pattern: "Every <thing>, ranked worst to best" },
] as const;
