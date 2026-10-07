import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assetUrl } from "@/lib/providers/storage";
import { handleError, ok } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const user = await getSessionUser();
    const where: Record<string, unknown> = { user_id: user.id };
    const runId = url.searchParams.get("runId");
    const sourceVideoId = url.searchParams.get("sourceVideoId");
    if (runId) where.run_id = runId;
    if (sourceVideoId) where.source_video_id = sourceVideoId;

    const variants = await db().list("variants", {
      where: where as never,
      orderBy: "created_at",
      direction: "desc",
      limit: Number(url.searchParams.get("limit") ?? 60),
    });

    return ok({
      variants: variants.map((v) => ({
        ...v,
        baseAssetUrl: assetUrl(v.base_asset_id),
        renderAssetUrl: assetUrl(v.render_asset_id),
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}
