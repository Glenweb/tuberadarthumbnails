import path from "node:path";
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import type { TextOverlay } from "@/lib/db/types";
import { FONTS } from "./fonts";
import {
  CANVAS_H,
  CANVAS_W,
  drawGuides,
  drawOverlay,
  drawScrim,
  type Ctx2D,
  type ScrimSpec,
} from "./draw";

export { CANVAS_W, CANVAS_H };
export type { ScrimSpec };

let fontsReady = false;

/** Register the bundled faces once per process. */
function ensureFonts() {
  if (fontsReady) return;
  const dir = path.join(process.cwd(), "public", "fonts");
  for (const f of FONTS) {
    try {
      GlobalFonts.registerFromPath(path.join(dir, f.file), f.id);
    } catch (err) {
      console.warn(`[compose] could not register font ${f.file}:`, err);
    }
  }
  fontsReady = true;
}

export type ComposeOptions = {
  base: Buffer;
  overlays: TextOverlay[];
  scrim?: ScrimSpec | null;
  /** Preview-only composition guides. */
  guides?: boolean;
  format?: "png" | "jpeg";
};

/**
 * Flatten base image + overlays into the final 1280x720 buffer — the single
 * source of truth for what the user downloads and uploads to YouTube.
 */
export async function composeThumbnail(opts: ComposeOptions): Promise<Buffer> {
  ensureFonts();
  const canvas = createCanvas(CANVAS_W, CANVAS_H);
  const ctx = canvas.getContext("2d");

  const img = await loadImage(opts.base);
  const scale = Math.max(CANVAS_W / img.width, CANVAS_H / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (CANVAS_W - dw) / 2, (CANVAS_H - dh) / 2, dw, dh);

  const shared = ctx as unknown as Ctx2D;
  drawScrim(shared, opts.scrim);
  for (const o of opts.overlays) drawOverlay(shared, o);
  if (opts.guides) drawGuides(shared);

  return opts.format === "jpeg" ? canvas.encode("jpeg", 92) : canvas.encode("png");
}

/**
 * A throwaway context used only for text measurement, with the bundled fonts
 * registered. Lets the overlay auto-fit measure real wrapped line boxes instead
 * of estimating from character counts.
 */
export function createMeasureContext(): Ctx2D {
  ensureFonts();
  return createCanvas(CANVAS_W, CANVAS_H).getContext("2d") as unknown as Ctx2D;
}

/** 168x94 shelf-size render — the size that actually decides clicks. */
export async function renderShelfPreview(full: Buffer): Promise<Buffer> {
  const img = await loadImage(full);
  const canvas = createCanvas(168, 94);
  canvas.getContext("2d").drawImage(img, 0, 0, 168, 94);
  return canvas.encode("png");
}
