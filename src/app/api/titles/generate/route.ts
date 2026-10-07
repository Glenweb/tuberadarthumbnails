import * as z from "zod";
import { getSessionUser } from "@/lib/auth";
import { spend } from "@/lib/credits";
import { db } from "@/lib/db";
import { generateTitles } from "@/lib/providers/claude";
import { scoreTitle } from "@/lib/scoring/title";
import { getShelf, latestShelf } from "@/lib/services/shelf";
import { newId, nowIso } from "@/lib/util/ids";
import type { TitleVariant } from "@/lib/db/types";
import { handleError, fail, ok, parseBody } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({
  sourceVideoId: z.string().optional(),
  topic: z.string().trim().max(500).optional(),
  keyword: z.string().trim().max(200).optional(),
  currentTitle: z.string().trim().max(300).optional(),
  shelfId: z.string().optional(),
  count: z.number().int().min(1).max(14).optional(),
  archetype: z.string().max(60).optional(),
  notes: z.string().trim().max(1000).optional(),
});

/**
 * Title variants, each pre-scored by the title pillar so the user sees a ranked
 * list rather than ten undifferentiated options.
 */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req, Body);
    const user = await getSessionUser();
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

    const charged = await spend(user, "titles", { note: topic.slice(0, 80) });
    const out = await generateTitles({
      topic,
      keyword,
      currentTitle: body.currentTitle ?? source?.title ?? null,
      transcript: source?.transcript ?? null,
      fingerprint: shelf?.fingerprint ?? null,
      competitorTitles: shelf?.videos.map((v) => v.title) ?? [],
      count: body.count ?? 10,
      archetype: body.archetype ?? null,
      notes: body.notes ?? null,
    });

    const runId = newId("trun");
    const rows: TitleVariant[] = out.data.map((t) => ({
      id: newId("title"),
      user_id: user.id,
      source_video_id: source?.id ?? null,
      run_id: runId,
      text: t.text,
      archetype: t.archetype,
      rationale: t.rationale,
      origin: out.source === "claude" ? "claude" : "heuristic",
      created_at: nowIso(),
    }));
    await store.insertMany("titles", rows);

    // Rank by the same title pillar the full score uses, so the ordering here
    // and the number on the scorer never disagree.
    const scored = rows
      .map((row) => ({
        ...row,
        pillar: scoreTitle(row.text, keyword, shelf?.fingerprint ?? null),
      }))
      .sort((a, b) => b.pillar.score - a.pillar.score);

    return ok({
      runId,
      titles: scored,
      source: out.source,
      note: out.note,
      keyword,
      creditsRemaining: charged.credits_remaining,
    });
  } catch (err) {
    return handleError(err);
  }
}
