import * as z from "zod";
import { PLANS } from "@/lib/config";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assetUrl } from "@/lib/providers/storage";
import { newId, nowIso } from "@/lib/util/ids";
import type { SavedWinner } from "@/lib/db/types";
import { handleError, fail, ok, parseBody } from "@/lib/api";

export const runtime = "nodejs";

const Body = z.object({
  variantId: z.string(),
  titleText: z.string().trim().min(1).max(300),
  titleVariantId: z.string().optional(),
  scoreId: z.string().optional(),
  sourceVideoId: z.string().optional(),
  keyword: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  trc: z.number().min(0).max(100),
});

export async function GET() {
  try {
    const user = await getSessionUser();
    const store = db();
    const winners = await store.list("winners", {
      where: { user_id: user.id },
      orderBy: "created_at",
      direction: "desc",
      limit: 200,
    });

    // Join the variant so the library can render thumbnails without N requests.
    const variants = await store.list("variants", { where: { user_id: user.id } });
    const byId = new Map(variants.map((v) => [v.id, v]));

    return ok({
      winners: winners.map((w) => {
        const v = byId.get(w.variant_id);
        return {
          ...w,
          label: v?.label ?? "Saved thumbnail",
          renderAssetUrl: assetUrl(v?.render_asset_id ?? null),
          overlays: v?.overlays ?? [],
          analysis: v?.analysis ?? null,
        };
      }),
      planLimit: (PLANS[user.plan] ?? PLANS.free).limits.savedWinners,
    });
  } catch (err) {
    return handleError(err);
  }
}

/** Save a title + thumbnail pairing to the winners library. */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req, Body);
    const user = await getSessionUser();
    const store = db();
    const plan = PLANS[user.plan] ?? PLANS.free;

    const variant = await store.get("variants", body.variantId);
    if (!variant || variant.user_id !== user.id) return fail("That variant was not found.", "not_found", 404);

    const count = await store.count("winners", { where: { user_id: user.id } });
    if (count >= plan.limits.savedWinners) {
      return fail(
        `${plan.name} stores ${plan.limits.savedWinners} saved winners. Upgrade or remove one to save more.`,
        "plan_limit",
        402,
      );
    }

    const winner: SavedWinner = {
      id: newId("win"),
      user_id: user.id,
      variant_id: body.variantId,
      title_variant_id: body.titleVariantId ?? null,
      score_id: body.scoreId ?? null,
      source_video_id: body.sourceVideoId ?? variant.source_video_id,
      title_text: body.titleText,
      trc: body.trc,
      keyword: body.keyword ?? null,
      notes: body.notes ?? null,
      actual: null,
      created_at: nowIso(),
    };
    await store.insert("winners", winner);

    return ok({ winner: { ...winner, renderAssetUrl: assetUrl(variant.render_asset_id) } });
  } catch (err) {
    return handleError(err);
  }
}
