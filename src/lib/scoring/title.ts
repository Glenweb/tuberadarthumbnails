import type { NicheFingerprint, ScorePillar } from "@/lib/db/types";
import { allCapsWords, bigrams, contentTokens, jaccard, syllables, tokenize } from "@/lib/util/text";
import { band, bandScore, fmtBand, makeItem, pct, riseScore, weighted } from "./bands";
import {
  BRACKET_RE,
  CURIOSITY_MARKERS,
  NEGATIVE_FRAMES,
  NUMBER_RE,
  OUTCOME_MARKERS,
  OVERCLAIM_MARKERS,
  POWER_WORDS,
  TIMEFRAME_RE,
  countMatches,
} from "./lexicon";

/** Characters YouTube shows before truncating, by surface. */
export const TRUNCATION = { mobileSearch: 48, desktopGrid: 60, suggested: 72 };

export function titleFacts(title: string) {
  const t = title.trim();
  const words = t.split(/\s+/).filter(Boolean);
  const tokens = tokenize(t);
  const caps = allCapsWords(t);
  return {
    length: t.length,
    wordCount: words.length,
    hook: t.slice(0, TRUNCATION.mobileSearch),
    truncatedOnMobile: t.length > TRUNCATION.mobileSearch,
    hasNumber: NUMBER_RE.test(t),
    hasTimeframe: TIMEFRAME_RE.test(t),
    hasBracket: BRACKET_RE.test(t),
    hasQuestion: t.includes("?"),
    curiosity: countMatches(t, CURIOSITY_MARKERS),
    outcome: countMatches(t, OUTCOME_MARKERS),
    power: countMatches(t, POWER_WORDS),
    overclaim: countMatches(t, OVERCLAIM_MARKERS),
    negative: countMatches(t, NEGATIVE_FRAMES),
    allCapsWords: caps,
    allCapsRatio: words.length ? caps.length / words.length : 0,
    exclamations: (t.match(/!/g) ?? []).length,
    avgSyllables: tokens.length
      ? tokens.reduce((a, w) => a + syllables(w), 0) / tokens.length
      : 0,
    tokens,
  };
}

/**
 * Title craft pillar.
 *
 * Scored for how the title performs *in a search result row* — truncated,
 * skimmed, and read next to ten rivals — not as a sentence in isolation.
 */
export function scoreTitle(
  title: string,
  keyword: string | null,
  fp: NicheFingerprint | null,
): ScorePillar {
  const f = titleFacts(title);

  /* ── Length & mobile truncation ── */
  const lengthBand = band(34, 62, 12, 100);
  let lengthScore = bandScore(f.length, lengthBand);
  // Truncation only hurts if the hook has not already landed. If the first 48
  // characters are self-contained, a long tail is harmless — even useful for
  // keyword coverage.
  if (f.truncatedOnMobile) {
    const hookTokens = contentTokens(f.hook);
    const hookSelfContained = hookTokens.length >= 4;
    lengthScore = hookSelfContained ? Math.min(100, lengthScore) : Math.max(0, lengthScore - 26);
  }

  /* ── Hook strength ──────────────────────────────────────────────────────
     A hook is any device that creates an information gap or stakes a claim
     specific enough to be worth verifying. Counting curiosity *words* alone
     fails the strongest format there is — a quantified result with a
     parenthetical twist ("I cut my AWS bill 70% in 3 days (nothing broke)")
     contains no "why" or "secret" and is a far better hook than one that does.
     So we detect devices, take the strongest, and reward stacking. */
  const devices: { id: string; weight: number; label: string }[] = [];
  if (f.curiosity.length) devices.push({ id: "open-loop", weight: 62, label: `open loop ("${f.curiosity[0]}")` });
  if (f.hasBracket && /\(|\[|—|–/.test(title)) devices.push({ id: "aside", weight: 46, label: "parenthetical aside" });
  if (f.hasNumber && (f.hasTimeframe || f.outcome.length > 0)) {
    devices.push({ id: "quantified", weight: 58, label: "quantified result claim" });
  }
  if (/\bi\b|\bmy\b|\bwe\b|\bour\b/i.test(title)) devices.push({ id: "first-person", weight: 48, label: "first-person proof" });
  if (/\bwithout\b|\bbut\b|\binstead\b|\bvs\.?\b|\bversus\b|\byet\b|\beven though\b/i.test(title)) {
    devices.push({ id: "tension", weight: 50, label: "tension / contrast" });
  }
  if (f.negative.length) devices.push({ id: "negative", weight: 44, label: "negative frame" });
  if (f.hasQuestion) devices.push({ id: "question", weight: 46, label: "direct question" });
  if (/\branked\b|\bevery\b|\bworst\b|\bbest\b|\btier\b|\bultimate\b/i.test(title)) {
    devices.push({ id: "ranking", weight: 42, label: "ranking frame" });
  }
  if (f.power.length) devices.push({ id: "charge", weight: 38, label: "high-charge wording" });

  const strongest = devices.length ? Math.max(...devices.map((d) => d.weight)) : 0;
  // Stacked devices compound: a quantified claim *with* an aside beats either.
  const curiosityScore = Math.min(100, strongest + Math.max(0, devices.length - 1) * 14);

  /* ── Specificity: numbers, timeframes, named things ── */
  const properNouns = title
    .split(/\s+/)
    .slice(1)
    .filter((w) => /^[A-Z][a-z]{2,}/.test(w)).length;
  const specificityScore = Math.min(
    100,
    (f.hasNumber ? 40 : 0) +
      (f.hasTimeframe ? 24 : 0) +
      Math.min(24, properNouns * 12) +
      f.outcome.length * 9,
  );

  /* ── Keyword front-loading ── */
  let keywordScore = 70;
  let keywordValue = "no target keyword set";
  if (keyword && keyword.trim()) {
    const kwTokens = contentTokens(keyword);
    const lower = title.toLowerCase();
    const present = kwTokens.filter((k) => lower.includes(k));
    const coverage = kwTokens.length ? present.length / kwTokens.length : 0;
    const firstPos = kwTokens.length
      ? Math.min(...kwTokens.map((k) => {
          const i = lower.indexOf(k);
          return i === -1 ? 999 : i;
        }))
      : 999;
    const positionScore = firstPos === 999 ? 0 : riseScore(1 - Math.min(firstPos, 60) / 60, 0, 1);
    keywordScore = coverage * 62 + positionScore * 0.38;
    keywordValue = `${pct(coverage)} of keyword present${
      firstPos < 999 ? `, first match at char ${firstPos}` : ", not present"
    }`;
  }

  /* ── Trust: overclaim and shout penalties ── */
  let trustScore = 100;
  trustScore -= f.overclaim.length * 34;
  trustScore -= Math.max(0, f.allCapsRatio - 0.22) * 150;
  trustScore -= Math.max(0, f.exclamations - 1) * 18;
  trustScore -= Math.max(0, f.power.length - 3) * 12;
  trustScore = Math.max(0, Math.min(100, trustScore));

  /* ── Readability at a glance ── */
  // One-sided on purpose: short, punchy words are an asset in a search result.
  // Only genuinely dense wording, or a title long enough to stop scanning,
  // costs anything here.
  const readabilityScore = weighted([
    { score: bandScore(f.avgSyllables, band(1.0, 2.0, 0.75, 3.0)), weight: 0.55 },
    { score: bandScore(f.wordCount, band(4, 13, 1, 21)), weight: 0.45 },
  ]);

  /* ── Distinctiveness against the shelf's own wording ── */
  let distinctScore = 72;
  let distinctValue = "no competitor titles available";
  let distinctNote = "Connect a keyword to measure wording overlap with the shelf.";
  if (fp && fp.title.commonBigrams.length > 0) {
    const myBigrams = bigrams(tokenize(title));
    const overlap = jaccard(myBigrams, fp.title.commonBigrams);
    const tokenOverlap = jaccard(contentTokens(title), fp.title.commonTokens);
    // Some overlap proves relevance; heavy overlap makes the row invisible.
    const combined = overlap * 0.6 + tokenOverlap * 0.4;
    distinctScore = bandScore(combined, band(0.06, 0.34, -0.16, 0.8));
    distinctValue = `${pct(combined)} phrase overlap with the shelf`;
    distinctNote =
      combined > 0.3
        ? "Your wording mirrors the titles above you — the row blends in. Change the framing, keep the keyword."
        : combined < 0.08
          ? "Almost no shared language with the shelf. Add the keyword's core noun so it still reads as relevant."
          : "Relevant to the shelf without echoing it — the right balance.";
  }

  const items = [
    makeItem({
      key: "hook_strength",
      label: "Hook strength",
      score: curiosityScore,
      weight: 0.24,
      value: devices.length ? devices.map((d) => d.label).join(" + ") : "no hook device",
      target: "2+ stacked hook devices",
      note: devices.length === 0
        ? "States a fact with nothing left unresolved. Add a quantified result, a contrast, or a parenthetical twist."
        : devices.length === 1
          ? `Carried by one device — ${devices[0].label}. Stacking a second is the cheapest lift available here.`
          : `${devices.length} hook devices stacked: ${devices.map((d) => d.label).join(", ")}.`,
    }),
    makeItem({
      key: "specificity",
      label: "Specificity",
      score: specificityScore,
      weight: 0.2,
      value: [
        f.hasNumber && "number",
        f.hasTimeframe && "timeframe",
        properNouns > 0 && `${properNouns} named thing(s)`,
      ].filter(Boolean).join(" · ") || "none",
      target: "number or timeframe + a named thing",
      note: specificityScore >= 70
        ? "Concrete enough to feel verifiable — that is what earns the click from a sceptical scroller."
        : "Vague. A number or a timeframe makes the promise checkable, which is what earns the click.",
    }),
    makeItem({
      key: "length",
      label: "Length & truncation",
      score: lengthScore,
      weight: 0.16,
      value: `${f.length} chars${f.truncatedOnMobile ? " — cut on mobile" : ""}`,
      target: `${fmtBand(lengthBand, false)} chars`,
      note: f.truncatedOnMobile
        ? `Mobile shows: "${f.hook}…" — check that still sells on its own.`
        : "Fits without truncation on every surface.",
    }),
    makeItem({
      key: "keyword",
      label: "Keyword placement",
      score: keywordScore,
      weight: 0.14,
      value: keywordValue,
      target: "full keyword, inside the first 30 chars",
      note: keywordScore >= 70
        ? "Search intent is matched early."
        : "Move the keyword's core noun towards the front — it drives both ranking and scan-recognition.",
    }),
    makeItem({
      key: "distinctiveness",
      label: "Distinctiveness",
      score: distinctScore,
      weight: 0.14,
      value: distinctValue,
      target: "8–30% overlap",
      note: distinctNote,
    }),
    makeItem({
      key: "trust",
      label: "Trust & restraint",
      score: trustScore,
      weight: 0.07,
      value: [
        f.overclaim.length && `${f.overclaim.length} overclaim`,
        f.allCapsRatio > 0.22 && `${pct(f.allCapsRatio)} caps`,
        f.exclamations > 1 && `${f.exclamations} exclamations`,
      ].filter(Boolean).join(" · ") || "clean",
      target: "no overclaims, <22% caps",
      note: trustScore >= 80
        ? "Confident without overpromising."
        : "Overpromising buys the click and loses the session. YouTube pays you for the session.",
    }),
    makeItem({
      key: "readability",
      label: "Readability",
      score: readabilityScore,
      weight: 0.05,
      value: `${f.wordCount} words · ${f.avgSyllables.toFixed(2)} syllables/word`,
      target: "5–11 words · 1.2–1.85 syllables",
      note: readabilityScore >= 70
        ? "Parses in one glance."
        : f.avgSyllables > 2.0
          ? "Dense wording. Swap the longest words for shorter ones — this is read at scroll speed, not studied."
          : "Long enough that scanning eyes will skip to the next row. Cut it back.",
    }),
  ];

  return {
    key: "title",
    label: "Title craft",
    score: Math.round(weighted(items)),
    weight: 0.25,
    items,
  };
}
