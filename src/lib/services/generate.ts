import { PLANS } from "@/lib/config";
import { db } from "@/lib/db";
import type {
  CompetitorShelf,
  SourceVideo,
  ThumbnailConcept,
  ThumbnailVariant,
  TrtUser,
} from "@/lib/db/types";
import { analyzeImage } from "@/lib/imaging/analyze";
import { composeThumbnail, createMeasureContext } from "@/lib/imaging/compose";
import { buildOverlays, suggestScrim, type OverlayStyle } from "@/lib/imaging/presets";
import { pickDirection } from "@/lib/imaging/synth";
import { generateConcepts, type ConceptContext } from "@/lib/providers/claude";
import { generateImage } from "@/lib/providers/gemini";
import { storeAsset } from "@/lib/providers/storage";
import { newId, nowIso } from "@/lib/util/ids";

export type GenerateOptions = {
  user: TrtUser;
  source: SourceVideo;
  shelf: CompetitorShelf | null;
  count: number;
  style?: OverlayStyle;
  notes?: string | null;
  brandPalette?: string[] | null;
  /** Reference image for image-to-image (a real face, a product shot). */
  reference?: { base64: string; mime: string } | null;
  /** Re-run against concepts already approved, skipping the concepting call. */
  concepts?: ThumbnailConcept[] | null;
};

export type GenerateResult = {
  runId: string;
  variants: ThumbnailVariant[];
  concepts: ThumbnailConcept[];
  conceptSource: "claude" | "heuristic";
  imageSource: "gemini" | "synthesized" | "mixed";
  notes: string[];
};

/**
 * Generate a batch of thumbnail variants end to end:
 * concept → base image → auto-laid-out overlays → 1280×720 composite → analysis.
 *
 * Variants are produced in parallel but bounded, and a single variant failing
 * never fails the run — the user gets the ones that worked plus a note about
 * the ones that did not.
 */
export async function generateVariants(opts: GenerateOptions): Promise<GenerateResult> {
  const store = db();
  const runId = newId("run");
  const notes: string[] = [];
  const plan = PLANS[opts.user.plan] ?? PLANS.free;
  const count = Math.max(1, Math.min(opts.count, plan.limits.variantsPerRun));
  if (count < opts.count) {
    notes.push(
      `${plan.name} generates up to ${plan.limits.variantsPerRun} variants per run — produced ${count}.`,
    );
  }

  const topic = opts.source.title || opts.source.description || "Untitled video";
  const conceptCtx: ConceptContext = {
    topic,
    keyword: opts.source.keyword,
    videoTitle: opts.source.title,
    description: opts.source.description,
    transcript: opts.source.transcript,
    fingerprint: opts.shelf?.fingerprint ?? null,
    competitorTitles: opts.shelf?.videos.map((v) => v.title) ?? [],
    count,
    notes: opts.notes ?? null,
    brandPalette: opts.brandPalette ?? null,
  };

  let concepts = opts.concepts ?? null;
  let conceptSource: GenerateResult["conceptSource"] = "heuristic";
  if (!concepts) {
    const out = await generateConcepts(conceptCtx);
    concepts = out.data;
    conceptSource = out.source;
    if (out.note) notes.push(out.note);
  } else {
    conceptSource = "claude";
  }

  const chosen = concepts.slice(0, count);
  const sources = new Set<string>();
  // One measuring context for the whole batch — font registration is the
  // expensive part and it is process-wide anyway.
  const measureCtx = createMeasureContext();

  const built = await Promise.all(
    chosen.map(async (concept, index) => {
      try {
        const seed = `${runId}:${concept.id}:${index}`;
        const image = await generateImage({
          prompt: concept.imagePrompt,
          seed,
          palette: concept.palette,
          direction: pickDirection(concept.angle, seed),
          angle: concept.angle,
          reference: opts.reference ?? null,
        });
        sources.add(image.source);
        if (image.note && index === 0) notes.push(image.note);

        const baseAnalysis = await analyzeImage(image.buffer);
        const overlays = buildOverlays({
          text: concept.overlayText,
          style: opts.style,
          palette: concept.palette,
          analysis: baseAnalysis,
          ctx: measureCtx,
        });
        const scrim = suggestScrim(overlays, baseAnalysis);
        const rendered = await composeThumbnail({
          base: image.buffer,
          overlays,
          scrim,
        });

        const [baseAsset, renderAsset, analysis] = await Promise.all([
          storeAsset({ userId: opts.user.id, kind: "base", data: image.buffer }),
          storeAsset({ userId: opts.user.id, kind: "render", data: rendered }),
          analyzeImage(rendered),
        ]);

        const variant: ThumbnailVariant = {
          id: newId("var"),
          user_id: opts.user.id,
          source_video_id: opts.source.id,
          run_id: runId,
          label: concept.name,
          concept,
          origin: image.source === "gemini" ? "generated" : "synthesized",
          base_asset_id: baseAsset.id,
          render_asset_id: renderAsset.id,
          overlays,
          analysis,
          created_at: nowIso(),
        };
        return variant;
      } catch (err) {
        console.error(`[generate] variant ${index} failed:`, err);
        notes.push(`Variant "${concept.name}" failed to render: ${String(err).slice(0, 140)}`);
        return null;
      }
    }),
  );

  const variants = built.filter((v): v is ThumbnailVariant => v !== null);
  if (variants.length > 0) await store.insertMany("variants", variants);

  return {
    runId,
    variants,
    concepts: chosen,
    conceptSource,
    imageSource: sources.size > 1 ? "mixed" : ((sources.values().next().value ?? "synthesized") as "gemini" | "synthesized"),
    notes,
  };
}

/** Re-render an existing variant after an overlay edit. */
export async function rerenderVariant(args: {
  user: TrtUser;
  variant: ThumbnailVariant;
  overlays?: ThumbnailVariant["overlays"];
  scrim?: { type: "none" | "bottom" | "left" | "radial" | "vignette"; strength: number } | null;
}): Promise<ThumbnailVariant> {
  const store = db();
  const base = await store.get("assets", args.variant.base_asset_id);
  if (!base) throw new Error("Base image for this variant is missing.");
  const blob = await store.getBlob(base.path);
  if (!blob) throw new Error("Base image bytes for this variant are missing.");

  const overlays = args.overlays ?? args.variant.overlays;
  const rendered = await composeThumbnail({
    base: blob.data,
    overlays,
    scrim: args.scrim ?? suggestScrim(overlays, args.variant.analysis),
  });

  const [asset, analysis] = await Promise.all([
    storeAsset({ userId: args.user.id, kind: "render", data: rendered }),
    analyzeImage(rendered),
  ]);

  // The previous render is no longer referenced; drop it so storage does not
  // accumulate one dead PNG per keystroke-triggered re-render.
  if (args.variant.render_asset_id) {
    const old = await store.get("assets", args.variant.render_asset_id);
    if (old) {
      await store.deleteBlob(old.path).catch(() => undefined);
      await store.remove("assets", old.id).catch(() => undefined);
    }
  }

  const updated = await store.update("variants", args.variant.id, {
    overlays,
    render_asset_id: asset.id,
    analysis,
  });
  return updated ?? { ...args.variant, overlays, render_asset_id: asset.id, analysis };
}
