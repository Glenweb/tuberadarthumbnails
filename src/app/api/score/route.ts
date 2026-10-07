import * as z from "zod";
import { getSessionUser } from "@/lib/auth";
import { spend } from "@/lib/credits";
import { db } from "@/lib/db";
import { capabilities } from "@/lib/config";
import { scoreAndStore } from "@/lib/services/score";
import { getShelf, latestShelf } from "@/lib/services/shelf";
import { handleError, fail, ok, parseBody } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 180;

const Body = z.object({
  title: z.string().trim().min(1).max(300),
  variantId: z.string().optional(),
  titleVariantId: z.string().optional(),
  sourceVideoId: z.string().optional(),
  keyword: z.string().trim().max(200).optional(),
  shelfId: z.string().optional(),
  withAi: z.boolean().optional(),
  /** Do not persist — used by the live editor for instant feedback. */
  preview: z.boolean().optional(),
});

/**
 * The core endpoint: score a title + thumbnail pair against its shelf.
 *
 * The deterministic engine always runs and always returns. `withAi` adds
 * Claude's visual critique on top and costs more credits — it is never required
 * for a usable answer.
 */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req, Body);
    const user = await getSessionUser();
    const store = db();

    const variant = body.variantId ? await store.get("variants", body.variantId) : null;
    if (body.variantId && (!variant || variant.user_id !== user.id)) {
      return fail("That variant was not found.", "not_found", 404);
    }

    const source = body.sourceVideoId ? await store.get("source_videos", body.sourceVideoId) : null;
    const keyword = body.keyword?.trim() || source?.keyword || null;
    const shelf = body.shelfId
      ? await getShelf(body.shelfId)
      : keyword
        ? await latestShelf(user.id, keyword)
        : null;
    if (shelf && shelf.user_id !== user.id) {
      return fail("That shelf was not found.", "not_found", 404);
    }

    // A preview from the live editor is free: charging per keystroke would make
    // the most useful feature in the product the one people avoid using.
    const wantsAi = Boolean(body.withAi) && capabilities().claude;
    const charged = body.preview
      ? user
      : await spend(user, wantsAi ? "score_ai" : "score", { note: body.title.slice(0, 60) });

    const result = await scoreAndStore({
      user: charged,
      title: body.title,
      variant,
      keyword,
      shelf,
      sourceVideoId: body.sourceVideoId ?? null,
      titleVariantId: body.titleVariantId ?? null,
      withAi: wantsAi,
      persist: !body.preview,
    });

    return ok({
      score: result.score,
      aiSource: result.aiSource,
      aiNote: result.aiNote,
      shelfKeyword: shelf?.keyword ?? null,
      shelfSource: shelf?.source ?? null,
      creditsRemaining: charged.credits_remaining,
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const user = await getSessionUser();
    const scores = await db().list("scores", {
      where: { user_id: user.id },
      orderBy: "created_at",
      direction: "desc",
      limit: Number(url.searchParams.get("limit") ?? 25),
    });
    return ok({ scores });
  } catch (err) {
    return handleError(err);
  }
}
