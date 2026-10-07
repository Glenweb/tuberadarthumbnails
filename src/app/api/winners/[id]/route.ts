import * as z from "zod";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { nowIso } from "@/lib/util/ids";
import { handleError, fail, ok, parseBody } from "@/lib/api";

export const runtime = "nodejs";

const Body = z.object({
  notes: z.string().trim().max(2000).optional(),
  /** Real-world result recorded after publishing — closes the feedback loop. */
  actual: z
    .object({ ctr: z.number().min(0).max(100).nullable(), views: z.number().min(0).nullable() })
    .optional(),
});

/**
 * Record what actually happened after publishing.
 *
 * Predicted-vs-actual is the only honest way to earn trust in a CTR estimate,
 * and over time this table is what lets a channel calibrate the model to its own
 * audience instead of a global average.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await parseBody(req, Body);
    const user = await getSessionUser();
    const store = db();
    const winner = await store.get("winners", id);
    if (!winner || winner.user_id !== user.id) return fail("Not found.", "not_found", 404);

    const updated = await store.update("winners", id, {
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.actual
        ? { actual: { ctr: body.actual.ctr, views: body.actual.views, recorded_at: nowIso() } }
        : {}),
    });
    return ok({ winner: updated });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await getSessionUser();
    const store = db();
    const winner = await store.get("winners", id);
    if (!winner || winner.user_id !== user.id) return fail("Not found.", "not_found", 404);
    await store.remove("winners", id);
    return ok({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}
