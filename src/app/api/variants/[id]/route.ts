import * as z from "zod";
import { getSessionUser } from "@/lib/auth";
import { spend } from "@/lib/credits";
import { db } from "@/lib/db";
import { assetUrl } from "@/lib/providers/storage";
import { rerenderVariant } from "@/lib/services/generate";
import { handleError, fail, ok, parseBody } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 60;

const Overlay = z.object({
  id: z.string(),
  text: z.string().max(200),
  x: z.number(), y: z.number(), w: z.number(),
  size: z.number().min(8).max(400),
  font: z.string(),
  weight: z.number(),
  color: z.string(),
  align: z.enum(["left", "center", "right"]),
  uppercase: z.boolean(),
  letterSpacing: z.number(),
  lineHeight: z.number(),
  stroke: z.object({ width: z.number(), color: z.string() }).nullable(),
  shadow: z.object({ blur: z.number(), color: z.string(), dx: z.number(), dy: z.number() }).nullable(),
  plate: z.object({ color: z.string(), padding: z.number(), radius: z.number() }).nullable(),
  rotation: z.number(),
});

const Body = z.object({
  overlays: z.array(Overlay).max(6),
  scrim: z
    .object({
      type: z.enum(["none", "bottom", "left", "radial", "vignette"]),
      strength: z.number().min(0).max(1),
    })
    .nullable()
    .optional(),
  label: z.string().max(80).optional(),
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await getSessionUser();
    const variant = await db().get("variants", id);
    if (!variant || variant.user_id !== user.id) return fail("Variant not found.", "not_found", 404);
    return ok({
      variant: {
        ...variant,
        baseAssetUrl: assetUrl(variant.base_asset_id),
        renderAssetUrl: assetUrl(variant.render_asset_id),
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

/** Apply overlay edits and re-render the flattened 1280x720 image. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await parseBody(req, Body);
    const user = await getSessionUser();
    const store = db();

    const variant = await store.get("variants", id);
    if (!variant || variant.user_id !== user.id) return fail("Variant not found.", "not_found", 404);

    const charged = await spend(user, "render", { note: `re-render ${id}` });
    const updated = await rerenderVariant({
      user: charged,
      variant,
      overlays: body.overlays,
      scrim: body.scrim ?? null,
    });
    if (body.label) await store.update("variants", id, { label: body.label });

    return ok({
      variant: {
        ...updated,
        label: body.label ?? updated.label,
        baseAssetUrl: assetUrl(updated.base_asset_id),
        renderAssetUrl: assetUrl(updated.render_asset_id),
      },
      creditsRemaining: charged.credits_remaining,
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await getSessionUser();
    const store = db();
    const variant = await store.get("variants", id);
    if (!variant || variant.user_id !== user.id) return fail("Variant not found.", "not_found", 404);
    await store.remove("variants", id);
    return ok({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}
