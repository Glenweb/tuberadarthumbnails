import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { readAsset } from "@/lib/providers/storage";

export const runtime = "nodejs";

/** Serve a stored image. Assets are tenant-scoped — never serve another user's. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const [user, asset] = await Promise.all([getSessionUser(), readAsset(id)]);
  if (!asset) return new NextResponse("Not found", { status: 404 });
  if (asset.asset.user_id !== user.id) return new NextResponse("Not found", { status: 404 });

  const body = new Uint8Array(asset.data);
  return new NextResponse(body, {
    headers: {
      "content-type": asset.mime,
      "content-length": String(asset.data.length),
      // Asset bytes are immutable: a re-render always mints a new id.
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
