import type {
  CompetitorVideo,
  FixSuggestion,
  ImageAnalysis,
  NicheFingerprint,
  PairScore,
  ScorePillar,
  TextOverlay,
} from "@/lib/db/types";
import { newId, nowIso } from "@/lib/util/ids";
import { clamp } from "@/lib/util/text";
import { riseScore, weighted } from "./bands";
import { scoreThumbnail } from "./image";
import { scoreTitle, titleFacts } from "./title";
import { scoreNicheFit, scorePairCoherence } from "./pair";

export const ENGINE_VERSION = "trc-1.2.0";

export type ScoreInput = {
  analysis: ImageAnalysis | null;
  title: string;
  overlays: TextOverlay[];
  keyword: string | null;
  fingerprint: NicheFingerprint | null;
  competitors: CompetitorVideo[];
  /** Where the competitor data came from, which sets confidence. */
  shelfSource?: "youtube_api" | "modelled" | null;
};

export type ScoreResult = Omit<
  PairScore,
  "id" | "user_id" | "variant_id" | "title_variant_id" | "source_video_id" | "shelf_id" | "critique"
> & {
  /** The rival most likely to be confused with this thumbnail. */
  twin: CompetitorVideo | null;
};

function gradeOf(trc: number): PairScore["grade"] {
  if (trc >= 85) return "S";
  if (trc >= 72) return "A";
  if (trc >= 58) return "B";
  if (trc >= 44) return "C";
  return "D";
}

/**
 * Modelled CTR band.
 *
 * This is an estimate derived from the score, not a measurement, and the UI
 * says so wherever it appears. The model: a shelf's median-scoring thumbnail
 * earns the shelf's typical search CTR; each point of TRC above or below that
 * median moves CTR by a fixed elasticity. The band widens as confidence drops,
 * so a modelled shelf never produces a falsely precise number.
 */
function estimateCtr(
  trc: number,
  fp: NicheFingerprint | null,
  shelfSource: ScoreInput["shelfSource"],
  analysedCount: number,
): PairScore["ctrEstimate"] {
  // Anchor: typical search-surface CTR for a video at the shelf median.
  const anchor = 5.0;
  const medianTrc = fp && fp.medianScore > 0 ? fp.medianScore : 55;
  // Elasticity: +25 TRC points ≈ +45% relative CTR.
  const k = Math.log(1.45) / 25;
  const centre = anchor * Math.exp(k * (trc - medianTrc));

  let confidence: PairScore["ctrEstimate"]["confidence"] = "low";
  if (shelfSource === "youtube_api" && analysedCount >= 8) confidence = "high";
  else if (shelfSource === "youtube_api" && analysedCount >= 4) confidence = "medium";
  else if (fp && fp.sampleSize >= 6) confidence = "medium";

  const spread = confidence === "high" ? 0.2 : confidence === "medium" ? 0.3 : 0.42;

  return {
    low: Number((centre * (1 - spread)).toFixed(1)),
    high: Number((centre * (1 + spread)).toFixed(1)),
    nicheMedian: fp && fp.medianScore > 0 ? anchor : null,
    confidence,
    basis:
      confidence === "high"
        ? `Modelled from ${analysedCount} live ranking thumbnails for this keyword.`
        : confidence === "medium"
          ? `Modelled from ${analysedCount || fp?.sampleSize || 0} reference thumbnails — treat as directional.`
          : "Modelled without live shelf data. Add a target keyword for a tighter estimate.",
  };
}

/** Rank the candidate inside the shelf it will actually appear in. */
function simulateShelf(trc: number, competitors: CompetitorVideo[]): PairScore["shelf"] {
  const scored = competitors
    .map((c) => c.score)
    .filter((s): s is number => typeof s === "number")
    .sort((a, b) => b - a);
  if (scored.length === 0) return null;
  const beats = scored.filter((s) => trc > s).length;
  return {
    rank: scored.length - beats + 1,
    outOf: scored.length + 1,
    beats,
    medianScore: Number(
      (scored.length % 2
        ? scored[(scored.length - 1) / 2]
        : (scored[scored.length / 2 - 1] + scored[scored.length / 2]) / 2
      ).toFixed(1),
    ),
    topScore: Number(scored[0].toFixed(1)),
  };
}

/**
 * Turn the weakest sub-scores into ranked, actionable fixes.
 *
 * Every fix carries the TRC points it is worth, computed from the actual
 * deficit against its band and the weight it carries — so the list is ordered
 * by real impact rather than by how alarming it sounds. Fixes the app can apply
 * itself are flagged, and the studio wires them to one-click buttons.
 */
function buildFixes(
  pillars: ScorePillar[],
  input: ScoreInput,
  twin: CompetitorVideo | null,
): FixSuggestion[] {
  const fixes: FixSuggestion[] = [];
  const tf = titleFacts(input.title);
  const a = input.analysis;

  for (const pillar of pillars) {
    for (const item of pillar.items) {
      const deficit = (100 - item.score) / 100;
      if (deficit < 0.18) continue;
      const gain = deficit * item.weight * pillar.weight * 100;
      if (gain < 0.6) continue;

      let autoFix: FixSuggestion["autoFix"];
      let title = item.label;
      let detail = item.note;

      switch (item.key) {
        case "shelf_legibility":
          title = "Rebuild for the 168×94 cell";
          detail =
            "Scale the subject to fill at least 40% of the frame, drop background detail, and raise overlay text to 110px+. Preview at shelf size before you commit.";
          autoFix = { type: "apply_shelf_preset", params: { minTextSize: 110, scrim: "bottom" } };
          break;
        case "contrast":
          title = a && a.contrast < 0.19 ? "Add tonal separation" : "Tame the contrast";
          autoFix = { type: "apply_scrim", params: { type: "bottom", strength: 0.55 } };
          break;
        case "focal_clarity":
          title = "Give the eye one subject";
          detail =
            "Blur or darken everything outside the subject. A thumbnail with two competing focal points reads as neither.";
          autoFix = { type: "apply_scrim", params: { type: "vignette", strength: 0.6 } };
          break;
        case "colour_punch":
          title = a && a.saturation < 0.3 ? "Lift the colour" : "Pull the saturation back";
          autoFix = { type: "adjust_saturation", params: { direction: a && a.saturation < 0.3 ? "up" : "down" } };
          break;
        case "text_load":
          title = a && a.textCoverage > 0.2 ? "Cut the overlay copy" : "Add a 3-word overlay";
          detail =
            a && a.textCoverage > 0.2
              ? "Reduce to three or four words at a much larger size. Same pixels, one idea instead of five."
              : "Three words at 120px carry further than eight at 60px.";
          break;
        case "composition":
          title = "Move the subject off centre";
          detail =
            "Put the subject on a vertical third and the copy in the opposite half. Keep the bottom-right corner clear — the duration pill covers it.";
          autoFix = { type: "reflow_overlays", params: { layout: "subject-right-copy-left" } };
          break;
        case "human_presence":
          title = "Put a face in frame";
          break;
        case "hook_strength":
          title = "Open a loop in the title";
          detail =
            "Your title states a fact. Reframe it so the payoff sits behind the click — a why, a what-happened, or a named mistake.";
          autoFix = { type: "regenerate_titles", params: { archetype: "curiosity-gap" } };
          break;
        case "specificity":
          title = "Make the promise checkable";
          detail = "Add a number, a timeframe or a named thing. 'Faster' is noise; '40% faster in 7 days' is a reason to click.";
          autoFix = { type: "regenerate_titles", params: { archetype: "number-outcome" } };
          break;
        case "length":
          title = tf.length > 62 ? "Tighten the title" : "Give the title more to say";
          detail = tf.truncatedOnMobile
            ? `Mobile cuts it to "${tf.hook}…". Front-load the hook so the visible half still sells.`
            : item.note;
          break;
        case "keyword":
          title = "Front-load the keyword";
          detail = `Move "${input.keyword ?? "your target keyword"}" into the first 30 characters.`;
          break;
        case "distinctiveness":
          title = "Break from the shelf's wording";
          autoFix = { type: "regenerate_titles", params: { archetype: "contrarian" } };
          break;
        case "trust":
          title = "Dial back the overclaim";
          break;
        case "redundancy":
          title = "Stop repeating the title";
          detail =
            "The overlay duplicates words the viewer already read. Say the thing the title could not fit — the number, the result, or the stake.";
          break;
        case "promise_alignment":
          title = "Close the promise gap";
          break;
        case "verbal_load":
          title = "Cut the total word count";
          break;
        case "overlay_discipline":
          title = "Trim the overlay to 3–5 words";
          break;
        case "convention_fit":
          title = "Match the shelf's format";
          break;
        case "differentiation":
          title = twin
            ? `Separate from rank ${twin.rank}`
            : "Break the shelf's colour pattern";
          detail = twin
            ? `"${twin.title.slice(0, 60)}" uses nearly your palette. Shift your dominant hue 60–120° away from it, or invert the light/dark balance.`
            : item.note;
          autoFix = { type: "shift_palette", params: { strategy: "complement" } };
          break;
        case "shelf_bar":
          title = "Clear the shelf's quality bar";
          detail = "Fix the highest-value items above first — this score follows them.";
          break;
      }

      fixes.push({
        id: `fix_${pillar.key}_${item.key}`,
        priority: 0,
        pillar: pillar.key,
        title,
        detail,
        estimatedGain: Number(gain.toFixed(1)),
        autoFixable: Boolean(autoFix),
        autoFix,
      });
    }
  }

  return fixes
    .sort((x, y) => y.estimatedGain - x.estimatedGain)
    .map((f, i) => ({ ...f, priority: i + 1 }))
    .slice(0, 8);
}

/**
 * Score one title + thumbnail pair.
 *
 * Deterministic end to end: the same inputs always produce the same number, no
 * model call is required, and the identical pipeline runs over every competitor
 * thumbnail — which is the only reason a shelf rank means anything.
 */
export function scorePair(input: ScoreInput): ScoreResult {
  const thumbnailPillar = input.analysis
    ? scoreThumbnail(input.analysis, input.fingerprint)
    : emptyThumbnailPillar();
  const titlePillar = scoreTitle(input.title, input.keyword, input.fingerprint);
  const pairPillar = scorePairCoherence(input.title, input.overlays, input.analysis);
  const niche = scoreNicheFit(input.analysis, input.title, input.fingerprint, input.competitors);

  // Provisional score, ignoring the shelf-bar item (which depends on it).
  const nicheProvisional = weighted(
    niche.pillar.items.filter((i) => i.key !== "shelf_bar"),
  );
  const provisional = weighted([
    { score: thumbnailPillar.score, weight: thumbnailPillar.weight },
    { score: titlePillar.score, weight: titlePillar.weight },
    { score: pairPillar.score, weight: pairPillar.weight },
    { score: nicheProvisional, weight: niche.pillar.weight },
  ]);

  // Now resolve the shelf bar against the provisional score.
  const medianTrc = input.fingerprint?.medianScore ?? 0;
  const barItem = niche.pillar.items.find((i) => i.key === "shelf_bar");
  if (barItem) {
    if (medianTrc > 0) {
      barItem.score = Math.round(
        clamp(riseScore(provisional - medianTrc, -18, 18), 0, 100),
      );
      barItem.value = `you ${provisional.toFixed(0)} vs shelf median ${medianTrc.toFixed(0)}`;
      barItem.verdict = barItem.score >= 78 ? "strong" : barItem.score >= 52 ? "ok" : "weak";
      barItem.note =
        provisional > medianTrc
          ? `Above the median of what already ranks, by ${(provisional - medianTrc).toFixed(0)} points.`
          : `Below the median of what already ranks, by ${(medianTrc - provisional).toFixed(0)} points. The shelf is the bar, not your last upload.`;
    } else {
      barItem.score = 60;
      barItem.value = "shelf not scored";
      barItem.note = "Load a competitor shelf to measure against what already ranks.";
    }
    niche.pillar.score = Math.round(weighted(niche.pillar.items));
  }

  const pillars = [thumbnailPillar, titlePillar, pairPillar, niche.pillar];
  const trc = Number(
    weighted(pillars.map((p) => ({ score: p.score, weight: p.weight }))).toFixed(1),
  );

  const analysed = input.competitors.filter((c) => c.analysis).length;

  return {
    trc,
    grade: gradeOf(trc),
    pillars,
    fixes: buildFixes(pillars, input, niche.twin),
    shelf: simulateShelf(trc, input.competitors),
    ctrEstimate: estimateCtr(trc, input.fingerprint, input.shelfSource ?? null, analysed),
    axes: niche.axes,
    engine_version: ENGINE_VERSION,
    created_at: nowIso(),
    twin: niche.twin,
  };
}

function emptyThumbnailPillar(): ScorePillar {
  return {
    key: "thumbnail",
    label: "Thumbnail craft",
    score: 0,
    weight: 0.35,
    items: [
      {
        key: "missing",
        label: "No thumbnail attached",
        score: 0,
        weight: 1,
        value: "—",
        target: "1280×720 image",
        verdict: "weak",
        note: "Attach or generate a thumbnail to score the visual half of the pair.",
      },
    ],
  };
}

/**
 * Score every competitor with the identical engine so shelf ranking is a
 * like-for-like comparison. Runs before the fingerprint's medianScore exists,
 * so the shelf-bar item is neutral for these.
 */
export function scoreCompetitors(
  competitors: CompetitorVideo[],
  fingerprint: NicheFingerprint,
): CompetitorVideo[] {
  return competitors.map((c) => {
    if (!c.analysis) return c;
    const others = competitors.filter((o) => o.youtube_id !== c.youtube_id);
    const result = scorePair({
      analysis: c.analysis,
      title: c.title,
      // Competitors' overlay copy is baked into their image; we cannot read it,
      // so pair coherence is scored on the title alone for both sides' fairness.
      overlays: [],
      keyword: null,
      fingerprint: { ...fingerprint, medianScore: 0 },
      competitors: others,
      shelfSource: null,
    });
    return { ...c, score: result.trc };
  });
}

export { buildFingerprint } from "./niche";
export { titleFacts } from "./title";
