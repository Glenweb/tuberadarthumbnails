import * as z from "zod";
import { PLANS } from "@/lib/config";
import { getSessionUser } from "@/lib/auth";
import { spend } from "@/lib/credits";
import { buildShelf, getShelf, latestShelf } from "@/lib/services/shelf";
import { handleError, fail, ok, parseBody } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({
  keyword: z.string().trim().min(2).max(200),
  depth: z.number().int().min(3).max(30).optional(),
  region: z.string().trim().length(2).optional(),
  refresh: z.boolean().optional(),
});

/** Build (or reuse) the competitor shelf for a keyword. */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req, Body);
    const user = await getSessionUser();
    const plan = PLANS[user.plan] ?? PLANS.free;
    const depth = Math.min(body.depth ?? plan.limits.competitorDepth, plan.limits.competitorDepth);

    // Only charge when we actually go and fetch: a cached shelf is free.
    const existing = body.refresh
      ? null
      : await latestShelf(user.id, body.keyword.trim());
    const fresh = !existing || Date.now() - new Date(existing.created_at).getTime() > 6 * 3600_000;
    const charged = fresh ? await spend(user, "competitor_shelf", { note: body.keyword }) : user;

    const result = await buildShelf({
      user: charged,
      keyword: body.keyword,
      depth,
      region: body.region,
      useCache: !body.refresh,
    });

    return ok({
      shelf: result.shelf,
      cached: result.cached,
      note: result.note,
      depthLimit: plan.limits.competitorDepth,
      imagesFetched: result.imagesFetched,
      imagesStandIn: result.imagesStandIn,
      creditsRemaining: charged.credits_remaining,
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const keyword = url.searchParams.get("keyword");
    const user = await getSessionUser();

    const shelf = id ? await getShelf(id) : await latestShelf(user.id, keyword);
    if (!shelf) return fail("No shelf found. Build one first.", "not_found", 404);
    if (shelf.user_id !== user.id) return fail("No shelf found.", "not_found", 404);
    return ok({ shelf });
  } catch (err) {
    return handleError(err);
  }
}
