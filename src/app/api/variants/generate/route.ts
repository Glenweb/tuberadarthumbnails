import * as z from "zod";
import { PLANS } from "@/lib/config";
import { getSessionUser } from "@/lib/auth";
import { refund, spend } from "@/lib/credits";
import { db } from "@/lib/db";
import { assetUrl } from "@/lib/providers/storage";
import { generateVariants } from "@/lib/services/generate";
import { getShelf, latestShelf } from "@/lib/services/shelf";
import type { ThumbnailConcept } from "@/lib/db/types";
import { handleError, fail, ok, parseBody } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 300;

const ConceptInput = z.object({
  id: z.string(),
  name: z.string(),
  angle: z.string(),
  imagePrompt: z.string(),
  overlayText: z.string(),
  palette: z.array(z.string()),
  rationale: z.string(),
  differentiator: z.string(),
});

const Body = z.object({
  sourceVideoId: z.string(),
  shelfId: z.string().optional(),
  count: z.number().int().min(1).max(8).optional(),
  style: z.enum(["impact", "plate", "kicker", "outline", "editorial"]).optional(),
  notes: z.string().trim().max(1000).optional(),
  brandPalette: z.array(z.string()).max(8).optional(),
  concepts: z.array(ConceptInput).max(8).optional(),
  reference: z.object({ base64: z.string(), mime: z.string() }).optional(),
});

/** The expensive step: concepts → images → composites → analysis. */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req, Body);
    const user = await getSessionUser();
    const plan = PLANS[user.plan] ?? PLANS.free;
    const store = db();

    const source = await store.get("source_videos", body.sourceVideoId);
    if (!source || source.user_id !== user.id) {
      return fail("That source video was not found.", "not_found", 404);
    }

    const count = Math.min(body.count ?? plan.limits.variantsPerRun, plan.limits.variantsPerRun);
    const shelf = body.shelfId
      ? await getShelf(body.shelfId)
      : source.keyword
        ? await latestShelf(user.id, source.keyword)
        : null;

    // Charge up front for the whole batch so a user cannot start a run they
    // cannot pay for; anything that fails to render is refunded below.
    let charged = await spend(user, "image_variant", {
      quantity: count,
      note: `${count} variants for ${source.title ?? source.id}`,
    });

    const result = await generateVariants({
      user: charged,
      source,
      shelf,
      count,
      style: body.style,
      notes: body.notes ?? null,
      brandPalette: body.brandPalette ?? null,
      reference: body.reference ?? null,
      concepts: (body.concepts as ThumbnailConcept[] | undefined) ?? null,
    });

    const failed = count - result.variants.length;
    if (failed > 0) {
      charged = await refund(charged, "image_variant", {
        quantity: failed,
        note: `${failed} variant(s) did not render`,
      });
    }

    return ok({
      runId: result.runId,
      variants: result.variants.map((v) => ({
        ...v,
        baseAssetUrl: assetUrl(v.base_asset_id),
        renderAssetUrl: assetUrl(v.render_asset_id),
      })),
      concepts: result.concepts,
      conceptSource: result.conceptSource,
      imageSource: result.imageSource,
      notes: result.notes,
      shelfId: shelf?.id ?? null,
      creditsRemaining: charged.credits_remaining,
    });
  } catch (err) {
    return handleError(err);
  }
}
