import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { analyzeImage, normalizeTo1280x720 } from "@/lib/imaging/analyze";
import { assetUrl, storeAsset } from "@/lib/providers/storage";
import { newId, nowIso } from "@/lib/util/ids";
import type { ThumbnailVariant } from "@/lib/db/types";
import { handleError, fail, ok } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 12 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/avif"];

/**
 * Upload an existing thumbnail to score or edit.
 *
 * This is the path most professional users start from: they already have a
 * thumbnail and want to know whether it wins its shelf. It needs no API keys at
 * all, so the highest-value workflow in the product is also the one with zero
 * setup cost.
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return fail("Attach an image file as `file`.", "invalid_request", 422);
    if (file.size > MAX_BYTES) return fail("Images must be 12MB or smaller.", "file_too_large", 413);
    if (file.type && !ACCEPTED.includes(file.type)) {
      return fail(`Unsupported image type "${file.type}". Use PNG, JPEG, WebP or AVIF.`, "unsupported_media_type", 415);
    }

    const user = await getSessionUser();
    const sourceVideoId = (form.get("sourceVideoId") as string | null) ?? null;
    const label = ((form.get("label") as string | null) ?? file.name ?? "Uploaded thumbnail").slice(0, 80);

    const raw = Buffer.from(await file.arrayBuffer());
    let normalised: Buffer;
    try {
      normalised = await normalizeTo1280x720(raw, "png");
    } catch {
      return fail("That file could not be read as an image.", "invalid_image", 422);
    }

    const [asset, analysis] = await Promise.all([
      storeAsset({ userId: user.id, kind: "base", data: normalised }),
      analyzeImage(normalised),
    ]);

    const variant: ThumbnailVariant = {
      id: newId("var"),
      user_id: user.id,
      source_video_id: sourceVideoId,
      run_id: newId("run"),
      label,
      concept: null,
      origin: "uploaded",
      base_asset_id: asset.id,
      // An upload is already flattened: base and render are the same bytes
      // until the user adds an overlay in the editor.
      render_asset_id: asset.id,
      overlays: [],
      analysis,
      created_at: nowIso(),
    };
    await db().insert("variants", variant);

    return ok({
      variant: { ...variant, baseAssetUrl: assetUrl(asset.id), renderAssetUrl: assetUrl(asset.id) },
      analysis,
    });
  } catch (err) {
    return handleError(err);
  }
}
