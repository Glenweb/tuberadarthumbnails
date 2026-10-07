import sharp from "sharp";
import { db } from "@/lib/db";
import type { StoredAsset } from "@/lib/db/types";
import { newId, nowIso } from "@/lib/util/ids";

/**
 * Asset storage: writes the bytes through whichever store is active and records
 * a row so assets can be listed, counted and garbage-collected per user.
 */
export async function storeAsset(args: {
  userId: string;
  kind: StoredAsset["kind"];
  data: Buffer;
  mime?: string;
}): Promise<StoredAsset> {
  const meta = await sharp(args.data).metadata();
  const mime = args.mime ?? (meta.format === "jpeg" ? "image/jpeg" : "image/png");
  const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
  const id = newId("asset");
  const path = `${args.userId}/${id}.${ext}`;

  const store = db();
  await store.putBlob(path.replace(/\//g, "_"), args.data, mime);

  return store.insert("assets", {
    id,
    user_id: args.userId,
    kind: args.kind,
    mime,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    bytes: args.data.length,
    path: path.replace(/\//g, "_"),
    created_at: nowIso(),
  });
}

export async function readAsset(
  id: string,
): Promise<{ data: Buffer; mime: string; asset: StoredAsset } | null> {
  const store = db();
  const asset = await store.get("assets", id);
  if (!asset) return null;
  const blob = await store.getBlob(asset.path);
  if (!blob) return null;
  return { data: blob.data, mime: asset.mime, asset };
}

/** Public URL the browser uses to load an asset. */
export function assetUrl(id: string | null | undefined): string | null {
  return id ? `/api/assets/${id}` : null;
}
