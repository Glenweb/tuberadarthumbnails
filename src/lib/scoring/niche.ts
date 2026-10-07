import type { CompetitorVideo, ImageAnalysis, NicheFingerprint } from "@/lib/db/types";
import { allCapsWords, bigrams, contentTokens, median, quantile, tokenize } from "@/lib/util/text";

/**
 * Build the visual + linguistic signature of a niche from the thumbnails and
 * titles that actually rank for a keyword.
 *
 * This is the piece generic thumbnail tools skip. "Is this a good thumbnail?"
 * is the wrong question — a finance thumbnail that would ace a generic rubric
 * can still die in a cooking shelf. The only useful question is "does this win
 * against the eleven cells it will physically sit next to?", and that needs the
 * shelf measured, not assumed.
 */
export function buildFingerprint(videos: CompetitorVideo[]): NicheFingerprint {
  const withAnalysis = videos.filter((v) => v.analysis) as (CompetitorVideo & {
    analysis: ImageAnalysis;
  })[];
  const titles = videos.map((v) => v.title).filter(Boolean);

  const a = withAnalysis.map((v) => v.analysis);
  const hueBins = new Array(12).fill(0);
  for (const an of a) {
    for (let i = 0; i < 12; i++) hueBins[i] += an.hueHistogram[i] ?? 0;
  }
  const hueTotal = hueBins.reduce((x, y) => x + y, 0) || 1;

  const colorCounts = new Map<string, number>();
  for (const an of a) {
    for (const c of an.dominantColors.slice(0, 3)) {
      colorCounts.set(c, (colorCounts.get(c) ?? 0) + 1);
    }
  }

  const titleLengths = titles.map((t) => t.length);
  const titleWordCounts = titles.map((t) => t.trim().split(/\s+/).length);
  const allTokens = titles.flatMap((t) => contentTokens(t));
  const allBigrams = titles.flatMap((t) => bigrams(tokenize(t)));

  const velocities = videos
    .map((v) => v.velocity)
    .filter((v): v is number => typeof v === "number" && v > 0);

  const scores = videos.map((v) => v.score).filter((s): s is number => typeof s === "number");

  const freq = (items: string[], n: number) => {
    const counts = new Map<string, number>();
    for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1);
    return [...counts.entries()]
      .filter(([, c]) => c > 1)
      .sort((x, y) => y[1] - x[1])
      .slice(0, n)
      .map(([k]) => k);
  };

  return {
    sampleSize: videos.length,
    faceRate: a.length ? a.filter((x) => x.faceRegion !== null).length / a.length : 0,
    textRate: a.length ? a.filter((x) => x.textCoverage > 0.04).length / a.length : 0,
    medianTextCoverage: median(a.map((x) => x.textCoverage)),
    medianSaturation: median(a.map((x) => x.saturation)),
    medianBrightness: median(a.map((x) => x.brightness)),
    medianContrast: median(a.map((x) => x.contrast)),
    medianColorfulness: median(a.map((x) => x.colorfulness)),
    medianEdgeDensity: median(a.map((x) => x.edgeDensity)),
    hueHistogram: hueBins.map((v) => Number((v / hueTotal).toFixed(4))),
    dominantColors: [...colorCounts.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 6)
      .map(([c]) => c),
    title: {
      medianLength: Math.round(median(titleLengths)),
      numberRate: titles.length ? titles.filter((t) => /\d/.test(t)).length / titles.length : 0,
      bracketRate: titles.length
        ? titles.filter((t) => /[[\](){}|]/.test(t)).length / titles.length
        : 0,
      allCapsWordRate: titles.length
        ? titles.filter((t) => allCapsWords(t).length > 0).length / titles.length
        : 0,
      questionRate: titles.length ? titles.filter((t) => t.includes("?")).length / titles.length : 0,
      medianWordCount: Math.round(median(titleWordCounts)),
      commonTokens: freq(allTokens, 12),
      commonBigrams: freq(allBigrams, 8),
    },
    medianScore: scores.length ? Number(median(scores).toFixed(1)) : 0,
    velocity: velocities.length
      ? {
          p25: Math.round(quantile(velocities, 0.25)),
          p50: Math.round(quantile(velocities, 0.5)),
          p75: Math.round(quantile(velocities, 0.75)),
        }
      : null,
  };
}

/** Cosine distance between two normalised hue histograms, 0-1. */
export function hueDistance(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < 12; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 1;
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Minimum hue distance to any single competitor — the "will this blend into its
 * neighbour" measure. Average distance hides the real risk: sitting right next
 * to one near-identical thumbnail is what actually costs the click.
 */
export function nearestNeighbourDistance(
  candidate: ImageAnalysis,
  competitors: CompetitorVideo[],
): { distance: number; twin: CompetitorVideo | null } {
  let best = 1;
  let twin: CompetitorVideo | null = null;
  for (const c of competitors) {
    if (!c.analysis) continue;
    const d = hueDistance(candidate.hueHistogram, c.analysis.hueHistogram);
    if (d < best) {
      best = d;
      twin = c;
    }
  }
  return { distance: best, twin };
}
