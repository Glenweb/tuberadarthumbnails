import type {
  CompetitorVideo,
  ImageAnalysis,
  NicheFingerprint,
  ScorePillar,
  TextOverlay,
} from "@/lib/db/types";
import { contentTokens, jaccard, tokenize } from "@/lib/util/text";
import { band, bandScore, makeItem, pct, riseScore, weighted } from "./bands";
import { hueDistance, nearestNeighbourDistance } from "./niche";
import { titleFacts } from "./title";

/**
 * Pair coherence pillar.
 *
 * The thumbnail and the title are one unit — a viewer reads them in a single
 * glance. Most tools score them separately and miss the two failure modes that
 * only exist in combination: the thumbnail repeating the title word for word
 * (half the cell wasted), and the thumbnail promising something the title never
 * delivers (the click converts, the session does not).
 */
export function scorePairCoherence(
  title: string,
  overlays: TextOverlay[],
  a: ImageAnalysis | null,
): ScorePillar {
  const overlayText = overlays.map((o) => o.text).join(" ").trim();
  const overlayTokens = contentTokens(overlayText);
  const titleTokens = contentTokens(title);
  const tf = titleFacts(title);
  const overlayWordCount = overlayText.split(/\s+/).filter(Boolean).length;

  /* ── Redundancy: repeated words are spent pixels ── */
  const overlap = overlayTokens.length ? jaccard(overlayTokens, titleTokens) : 0;
  const redundancyScore = overlayTokens.length === 0
    ? 70
    : bandScore(overlap, band(0, 0.26, -0.01, 0.78));

  /* ── Combined verbal load across both surfaces ── */
  const combinedWords = tf.wordCount + overlayWordCount;
  const loadScore = bandScore(combinedWords, band(6, 14, 2, 26));

  /* ── Promise alignment ── */
  let alignScore = 72;
  const alignNotes: string[] = [];
  if (overlayTokens.length > 0) {
    // Some shared concept is required; zero shared meaning reads as a mismatch.
    const shared = overlayTokens.filter((t) => titleTokens.includes(t)).length;
    const conceptual = shared > 0 || overlap > 0.05;
    alignScore = conceptual ? 86 : 54;
    if (!conceptual) alignNotes.push("Overlay copy shares no idea with the title.");
  }
  // Numeric promise should be visible, not just stated.
  if (tf.hasNumber && overlayText && !/\d/.test(overlayText)) {
    alignScore -= 10;
    alignNotes.push("The title's number is the hook — put it in the thumbnail, large.");
  }
  if (tf.hasNumber && /\d/.test(overlayText)) {
    alignScore = Math.min(100, alignScore + 10);
    alignNotes.push("The number appears in both surfaces — the promise is visible.");
  }
  // First-person titles want a human in frame.
  if (/\bi\b|\bmy\b|\bwe\b/i.test(title) && a) {
    if (a.faceRegion) {
      alignScore = Math.min(100, alignScore + 8);
      alignNotes.push("First-person title backed by a face in frame.");
    } else {
      alignScore -= 12;
      alignNotes.push("A first-person title with no person in the thumbnail breaks the promise.");
    }
  }
  alignScore = Math.max(0, Math.min(100, alignScore));

  /* ── Does the thumbnail carry copy at all where it should? ── */
  const overlayPresenceScore =
    overlayWordCount === 0
      ? tf.wordCount <= 7
        ? 62
        : 44
      : overlayWordCount <= 5
        ? 100
        : overlayWordCount <= 7
          ? 74
          : 40;

  const items = [
    makeItem({
      key: "redundancy",
      label: "Word redundancy",
      score: redundancyScore,
      weight: 0.3,
      value: overlayTokens.length ? `${pct(overlap)} repeated from the title` : "no overlay copy",
      target: "under 26% repeated",
      note:
        overlap > 0.26
          ? "The thumbnail repeats the title. Use those pixels to say the thing the title cannot."
          : overlayTokens.length === 0
            ? "No overlay copy — the title is carrying the whole message alone."
            : "Thumbnail and title each add something. This is the pairing that converts.",
    }),
    makeItem({
      key: "promise_alignment",
      label: "Promise alignment",
      score: alignScore,
      weight: 0.34,
      value: alignNotes.length ? alignNotes[0] : "consistent",
      target: "thumbnail shows what the title promises",
      note:
        alignNotes.join(" ") ||
        "Thumbnail and title point at the same payoff — the click and the watch stay aligned.",
    }),
    makeItem({
      key: "verbal_load",
      label: "Combined word load",
      score: loadScore,
      weight: 0.2,
      value: `${combinedWords} words (${tf.wordCount} title + ${overlayWordCount} overlay)`,
      target: "6–14 words total",
      note:
        combinedWords > 14
          ? "Too much to read in the half-second a scroll gives you. Cut the overlay first."
          : "Readable in a single glance.",
    }),
    makeItem({
      key: "overlay_discipline",
      label: "Overlay discipline",
      score: overlayPresenceScore,
      weight: 0.16,
      value: `${overlayWordCount} overlay word(s)`,
      target: "3–5 words",
      note:
        overlayWordCount > 5
          ? "Over five words the overlay stops being a hook and becomes a paragraph."
          : overlayWordCount === 0
            ? "Consider 3 words of overlay to carry a second idea."
            : "Tight overlay copy — it stays legible at shelf size.",
    }),
  ];

  return {
    key: "pair",
    label: "Pair coherence",
    score: Math.round(weighted(items)),
    weight: 0.15,
    items,
  };
}

/**
 * Niche fit & differentiation pillar — the dual axis.
 *
 * Two forces decide a click in a search shelf and they pull against each other.
 * **Pattern match**: a thumbnail that violates the niche's conventions reads as
 * off-topic and gets skipped. **Pattern interrupt**: a thumbnail identical to
 * its neighbours is invisible. The winner matches the shelf on structure (does
 * it have a face, is there text, is it clear) and breaks from it on surface
 * (colour, wording). We score those separately so the advice can be specific
 * instead of "make it pop".
 */
export function scoreNicheFit(
  a: ImageAnalysis | null,
  title: string,
  fp: NicheFingerprint | null,
  competitors: CompetitorVideo[],
): { pillar: ScorePillar; axes: { conventionFit: number; differentiation: number }; twin: CompetitorVideo | null } {
  if (!a || !fp || fp.sampleSize === 0) {
    const items = [
      makeItem({
        key: "no_shelf",
        label: "Shelf not loaded",
        score: 60,
        weight: 1,
        value: "no competitor data",
        target: "10+ ranking videos",
        note: "Add a target keyword to measure this thumbnail against the shelf it will actually sit in.",
      }),
    ];
    return {
      pillar: { key: "niche", label: "Niche fit & differentiation", score: 60, weight: 0.25, items },
      axes: { conventionFit: 60, differentiation: 60 },
      twin: null,
    };
  }

  /* ── Convention fit: do you belong in this result set? ── */
  const structural: { score: number; weight: number }[] = [];
  // Face convention.
  const hasFace = a.faceRegion !== null;
  if (fp.faceRate >= 0.6) structural.push({ score: hasFace ? 100 : 40, weight: 1 });
  else if (fp.faceRate <= 0.25) structural.push({ score: hasFace ? 78 : 100, weight: 0.6 });
  else structural.push({ score: 88, weight: 0.4 });
  // Text convention.
  const hasText = a.textCoverage > 0.035;
  if (fp.textRate >= 0.6) structural.push({ score: hasText ? 100 : 46, weight: 1 });
  else if (fp.textRate <= 0.25) structural.push({ score: hasText ? 82 : 100, weight: 0.6 });
  else structural.push({ score: 90, weight: 0.4 });
  // Tonal register: being far outside the shelf's brightness/contrast norms
  // reads as a different kind of content altogether.
  const near = (v: number, m: number, tolerance: number) =>
    riseScore(1 - Math.min(1, Math.abs(v - m) / tolerance), 0, 1);
  structural.push({ score: near(a.brightness, fp.medianBrightness, 0.34), weight: 0.8 });
  structural.push({ score: near(a.contrast, fp.medianContrast, 0.22), weight: 0.8 });
  structural.push({ score: near(a.saturation, fp.medianSaturation, 0.34), weight: 0.6 });
  const conventionFit = weighted(structural);

  /* ── Differentiation: would you be noticed next to them? ── */
  const nn = nearestNeighbourDistance(a, competitors);
  // Colour separation from the single most similar neighbour.
  const colourDiff = riseScore(nn.distance, 0.05, 0.45);
  // Average separation from the whole shelf.
  const analysed = competitors.filter((c) => c.analysis);
  const avgDistance = analysed.length
    ? analysed.reduce((acc, c) => acc + hueDistance(a.hueHistogram, c.analysis!.hueHistogram), 0) /
      analysed.length
    : 0.5;
  const shelfDiff = riseScore(avgDistance, 0.08, 0.5);
  // Wording novelty against the shelf's shared phrases.
  const wordNovelty = fp.title.commonBigrams.length
    ? riseScore(1 - jaccard(tokenize(title), fp.title.commonBigrams.flatMap((b) => b.split(" "))), 0.5, 0.95)
    : 70;
  const differentiation = weighted([
    { score: colourDiff, weight: 0.45 },
    { score: shelfDiff, weight: 0.3 },
    { score: wordNovelty, weight: 0.25 },
  ]);

  /* ── Clearing the bar the shelf already set ── */
  const barScore = fp.medianScore > 0 ? 0 : 0; // placeholder, filled by the orchestrator

  const items = [
    makeItem({
      key: "convention_fit",
      label: "Convention fit (pattern match)",
      score: conventionFit,
      weight: 0.42,
      value: `${hasFace ? "face" : "no face"} · ${hasText ? "text" : "no text"} · ${pct(a.brightness)} brightness`,
      target: `shelf: ${pct(fp.faceRate)} faces, ${pct(fp.textRate)} text, ${pct(fp.medianBrightness)} brightness`,
      note:
        conventionFit >= 78
          ? "Reads as belonging in this result set — viewers will accept it as relevant."
          : fp.faceRate >= 0.6 && !hasFace
            ? `${pct(fp.faceRate)} of ranking thumbnails lead with a face. Yours does not, and that gap costs relevance here.`
            : fp.textRate >= 0.6 && !hasText
              ? `${pct(fp.textRate)} of this shelf carries overlay text. A bare image reads as off-format.`
              : "Tonally outside the shelf — viewers may not read it as the same kind of video.",
    }),
    makeItem({
      key: "differentiation",
      label: "Differentiation (pattern interrupt)",
      score: differentiation,
      weight: 0.42,
      value: `${pct(nn.distance)} colour distance from nearest rival`,
      target: "25%+ from the closest neighbour",
      note:
        nn.twin && nn.distance < 0.15
          ? `Nearly the same palette as "${nn.twin.title.slice(0, 48)}${nn.twin.title.length > 48 ? "…" : ""}" at rank ${nn.twin.rank}. Side by side, one of you disappears — and it will not be the one with more subscribers.`
          : differentiation >= 78
            ? "Visually separates from the shelf while staying on-format. This is the combination that wins the click."
            : "Blends into the shelf's colour range. Shift the dominant hue away from the pack.",
    }),
    makeItem({
      key: "shelf_bar",
      label: "Shelf quality bar",
      score: barScore,
      weight: 0.16,
      value: `shelf median ${fp.medianScore.toFixed(0)}`,
      target: `beat ${fp.medianScore.toFixed(0)}`,
      note: "Measured against the median score of the videos already ranking.",
    }),
  ];

  return {
    pillar: {
      key: "niche",
      label: "Niche fit & differentiation",
      score: Math.round(weighted(items)),
      weight: 0.25,
      items,
    },
    axes: { conventionFit: Math.round(conventionFit), differentiation: Math.round(differentiation) },
    twin: nn.twin,
  };
}
