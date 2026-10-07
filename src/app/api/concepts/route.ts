import * as z from "zod";
import { PLANS } from "@/lib/config";
import { getSessionUser } from "@/lib/auth";
import { spend } from "@/lib/credits";
import { db } from "@/lib/db";
import { generateConcepts } from "@/lib/providers/claude";
import { latestShelf, getShelf } from "@/lib/services/shelf";
import { handleError, fail, ok, parseBody } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({
  sourceVideoId: z.string().optional(),
  topic: z.string().trim().max(500).optional(),
  keyword: z.string().trim().max(200).optional(),
  shelfId: z.string().optional(),
  count: z.number().int().min(1).max(8).optional(),
  notes: z.string().trim().max(1000).optional(),
  brandPalette: z.array(z.string()).max(8).optional(),
});

/**
 * Concepts without committing to image generation — the cheap step, so users
 * can iterate on direction before spending credits on renders.
 */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req, Body);
    const user = await getSessionUser();
    const plan = PLANS[user.plan] ?? PLANS.free;
    const store = db();

    const source = body.sourceVideoId ? await store.get("source_videos", body.sourceVideoId) : null;
    if (body.sourceVideoId && (!source || source.user_id !== user.id)) {
      return fail("That source video was not found.", "not_found", 404);
    }
    const topic = body.topic?.trim() || source?.title || source?.description;
    if (!topic) return fail("Provide a topic or a source video.", "invalid_request", 422);

    const keyword = body.keyword?.trim() || source?.keyword || null;
    const shelf = body.shelfId
      ? await getShelf(body.shelfId)
      : keyword
        ? await latestShelf(user.id, keyword)
        : null;

    const charged = await spend(user, "concepts", { note: topic.slice(0, 80) });
    const out = await generateConcepts({
      topic,
      keyword,
      videoTitle: source?.title ?? null,
      description: source?.description ?? null,
      transcript: source?.transcript ?? null,
      fingerprint: shelf?.fingerprint ?? null,
      competitorTitles: shelf?.videos.map((v) => v.title) ?? [],
      count: Math.min(body.count ?? plan.limits.variantsPerRun, plan.limits.variantsPerRun),
      notes: body.notes ?? null,
      brandPalette: body.brandPalette ?? null,
    });

    return ok({
      concepts: out.data,
      source: out.source,
      note: out.note,
      creditsRemaining: charged.credits_remaining,
    });
  } catch (err) {
    return handleError(err);
  }
}
