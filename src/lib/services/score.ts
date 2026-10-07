import { db } from "@/lib/db";
import type {
  CompetitorShelf,
  ImageAnalysis,
  PairScore,
  TextOverlay,
  ThumbnailVariant,
  TrtUser,
} from "@/lib/db/types";
import { critiquePair } from "@/lib/providers/claude";
import { readAsset } from "@/lib/providers/storage";
import { scorePair, type ScoreResult } from "@/lib/scoring";
import { newId } from "@/lib/util/ids";

/** Compact, factual summary of the measured signals, handed to Claude as ground truth. */
export function describeSignals(a: ImageAnalysis | null, result: ScoreResult): string {
  if (!a) return "No thumbnail attached.";
  const p = (v: number) => `${Math.round(v * 100)}%`;
  return [
    `Overall TRC ${result.trc} (grade ${result.grade}).`,
    `Pillars: ${result.pillars.map((x) => `${x.label} ${x.score}`).join(", ")}.`,
    `Contrast ${p(a.contrast)}, brightness ${p(a.brightness)}, saturation ${p(a.saturation)}, colourfulness ${p(a.colorfulness)}.`,
    `Shelf-size survival: contrast ${p(a.shelfContrast)}, detail retained ${p(a.shelfDetailRetention)}.`,
    `Focal concentration ${p(a.focalConcentration)} at (${p(a.focalPoint.x)}, ${p(a.focalPoint.y)}).`,
    `Overlay text covers ${p(a.textCoverage)} of the frame. Face detected: ${a.faceRegion ? "yes" : "no"}.`,
    result.shelf
      ? `Simulated shelf position: #${result.shelf.rank} of ${result.shelf.outOf} (shelf median ${result.shelf.medianScore}, top ${result.shelf.topScore}).`
      : "No shelf loaded.",
    `Axes: convention fit ${result.axes.conventionFit}/100, differentiation ${result.axes.differentiation}/100.`,
  ].join("\n");
}

export type ScoreRequest = {
  user: TrtUser;
  title: string;
  /** Either a saved variant, or an ad-hoc analysis for an uploaded image. */
  variant?: ThumbnailVariant | null;
  analysis?: ImageAnalysis | null;
  overlays?: TextOverlay[];
  assetIdForCritique?: string | null;
  keyword?: string | null;
  shelf?: CompetitorShelf | null;
  sourceVideoId?: string | null;
  titleVariantId?: string | null;
  /** Run Claude's visual critique on top of the deterministic engine. */
  withAi?: boolean;
  persist?: boolean;
};

export type ScoreResponse = {
  score: PairScore;
  aiSource: "claude" | "heuristic" | "skipped";
  aiNote?: string;
};

/**
 * Score a title + thumbnail pair and, optionally, layer Claude's visual read on
 * top. The deterministic result is produced first and always returned — the AI
 * layer is additive commentary, never a dependency.
 */
export async function scoreAndStore(req: ScoreRequest): Promise<ScoreResponse> {
  const analysis = req.analysis ?? req.variant?.analysis ?? null;
  const overlays = req.overlays ?? req.variant?.overlays ?? [];
  const shelf = req.shelf ?? null;

  const result = scorePair({
    analysis,
    title: req.title,
    overlays,
    keyword: req.keyword ?? shelf?.keyword ?? null,
    fingerprint: shelf?.fingerprint ?? null,
    competitors: shelf?.videos ?? [],
    shelfSource: shelf?.source ?? null,
  });

  let critique: PairScore["critique"] = null;
  let aiSource: ScoreResponse["aiSource"] = "skipped";
  let aiNote: string | undefined;

  if (req.withAi) {
    const assetId = req.assetIdForCritique ?? req.variant?.render_asset_id ?? null;
    let imageBase64: string | null = null;
    let imageMime = "image/png";
    if (assetId) {
      const asset = await readAsset(assetId);
      if (asset) {
        imageBase64 = asset.data.toString("base64");
        imageMime = asset.mime;
      }
    }

    // Show Claude the actual neighbours, so the critique is comparative.
    const shelfImages: { base64: string; mime: string; title: string }[] = [];
    for (const competitor of (shelf?.videos ?? []).slice(0, 3)) {
      if (!competitor.thumbnail_url || competitor.thumbnail_url.startsWith("synthetic:")) continue;
      try {
        const res = await fetch(competitor.thumbnail_url);
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 2000) continue;
        shelfImages.push({
          base64: buf.toString("base64"),
          mime: res.headers.get("content-type") ?? "image/jpeg",
          title: competitor.title,
        });
      } catch {
        // A competitor image we cannot fetch simply is not shown.
      }
    }

    const out = await critiquePair({
      title: req.title,
      keyword: req.keyword ?? shelf?.keyword ?? null,
      imageBase64,
      imageMime,
      shelfImages,
      fingerprint: shelf?.fingerprint ?? null,
      deterministicSummary: describeSignals(analysis, result),
    });
    aiSource = out.source;
    aiNote = out.note;
    if (out.source === "claude") critique = out.data;
  }

  const score: PairScore = {
    id: newId("score"),
    user_id: req.user.id,
    variant_id: req.variant?.id ?? null,
    title_variant_id: req.titleVariantId ?? null,
    source_video_id: req.sourceVideoId ?? req.variant?.source_video_id ?? null,
    shelf_id: shelf?.id ?? null,
    trc: result.trc,
    grade: result.grade,
    pillars: result.pillars,
    fixes: result.fixes,
    shelf: result.shelf,
    ctrEstimate: result.ctrEstimate,
    axes: result.axes,
    critique,
    engine_version: result.engine_version,
    created_at: result.created_at,
  };

  if (req.persist !== false) await db().insert("scores", score);
  return { score, aiSource, aiNote };
}
