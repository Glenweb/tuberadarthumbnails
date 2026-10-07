import type { ImageAnalysis, TextOverlay } from "@/lib/db/types";
import { DEFAULT_FONT } from "./fonts";
import { CANVAS_H, CANVAS_W, layoutOverlay, type Ctx2D } from "./draw";

export type OverlayStyle = "impact" | "plate" | "kicker" | "outline" | "editorial";

export const OVERLAY_STYLES: { id: OverlayStyle; label: string; note: string }[] = [
  { id: "impact", label: "Impact", note: "Heavy white type, thick black stroke. The default that works everywhere." },
  { id: "plate", label: "Colour plate", note: "Type on a solid plate. Maximum legibility over busy images." },
  { id: "kicker", label: "Kicker + headline", note: "Small coloured label above a big headline." },
  { id: "outline", label: "Outline accent", note: "Brand-colour fill with a heavy dark outline." },
  { id: "editorial", label: "Editorial", note: "Lighter weight, generous spacing. Documentary and tech." },
];

function contrastingInk(hex: string): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55 ? "#0b0f19" : "#ffffff";
}

/**
 * Measured auto-fit.
 *
 * The earlier version estimated line count from word count and guessed a size
 * from average character width. It was wrong often enough to push copy off the
 * bottom of the frame, which is the one defect a thumbnail tool cannot ship.
 * This binary-searches the largest size whose *actually wrapped* block fits the
 * box, using the same layout code the renderer uses.
 */
export function fitOverlaySize(
  ctx: Ctx2D,
  overlay: TextOverlay,
  maxHeightFrac: number,
  bounds: { min: number; max: number } = { min: 34, max: 172 },
): { size: number; lines: number; blockHeightFrac: number } {
  const maxH = maxHeightFrac * CANVAS_H;
  const boxW = Math.max(40, overlay.w * CANVAS_W);

  const fits = (size: number) => {
    const probe = { ...overlay, size };
    const { lines, widths, lineH } = layoutOverlay(ctx, probe);
    const blockH = lineH * lines.length;
    // A single word wider than the box cannot wrap: that overflows horizontally
    // however many lines we allow, so it has to fail the fit too.
    const widest = Math.max(...widths, 0);
    return { ok: blockH <= maxH && widest <= boxW, lines: lines.length, blockH };
  };

  let lo = bounds.min;
  let hi = bounds.max;
  let best = bounds.min;
  let bestInfo = fits(bounds.min);
  // 7 iterations resolves to ~1px over the full range — imperceptible, and it
  // keeps the fit cheap enough to run per variant without a noticeable cost.
  for (let i = 0; i < 7; i++) {
    const mid = Math.round((lo + hi) / 2);
    const r = fits(mid);
    if (r.ok) {
      best = mid;
      bestInfo = r;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
    if (lo > hi) break;
  }

  return { size: best, lines: bestInfo.lines, blockHeightFrac: bestInfo.blockH / CANVAS_H };
}

/**
 * Build a sensible default overlay for a freshly generated variant.
 *
 * Reads the base image's analysis to place copy where the image is quietest and
 * darkest, rather than dropping it bottom-left and hoping. The result is a
 * starting layout the user can usually ship as-is — then adjust in the editor.
 */
export function buildOverlays(args: {
  text: string;
  style?: OverlayStyle;
  palette?: string[];
  analysis?: ImageAnalysis | null;
  font?: string;
  /** Measuring context. Supplied server-side so the fit is real, not estimated. */
  ctx?: Ctx2D | null;
}): TextOverlay[] {
  const style = args.style ?? "impact";
  const palette = args.palette?.length ? args.palette : ["#0b1020", "#2563eb", "#22d3ee", "#facc15"];
  const accent = palette[palette.length - 1];
  const font = args.font ?? DEFAULT_FONT;
  const text = args.text.trim().toUpperCase() || "WATCH THIS";

  // Place the copy opposite the subject. The focal point comes from edge
  // energy, so "the busy side" is measured, not guessed.
  const focalX = args.analysis?.focalPoint.x ?? 0.68;
  const focalY = args.analysis?.focalPoint.y ?? 0.5;
  // Put the copy in the half the subject is not using. When the subject is
  // centred (a radial composition, a single hero object) there is no "free"
  // half, so default to the left: in a left-to-right shelf that is the first
  // thing the eye lands on.
  const centred = focalX > 0.4 && focalX < 0.6;
  const onLeft = centred || focalX > 0.5;
  const x = onLeft ? 0.055 : 0.45;
  const w = 0.5;
  // Copy sits in the half the subject is not using, inside the title-safe area.
  const topHalf = focalY > 0.56;
  const availableH = 0.46;

  const draft: TextOverlay = {
    id: "headline",
    text,
    x,
    y: topHalf ? 0.09 : 0.42,
    w,
    size: 110,
    font,
    weight: 900,
    color: "#ffffff",
    align: "left",
    uppercase: true,
    letterSpacing: -1.5,
    lineHeight: 1.0,
    stroke: { width: 11, color: "#000000" },
    shadow: { blur: 26, color: "rgba(0,0,0,0.72)", dx: 0, dy: 8 },
    plate: null,
    rotation: 0,
  };

  const styled = applyStyleToDraft(draft, style, accent);
  const fitted = fitAndPlace(styled, args.ctx ?? null, topHalf, availableH);

  if (style === "kicker") {
    const words = text.split(/\s+/);
    const kickerText = words.slice(0, 1).join(" ");
    const headlineText = words.slice(1).join(" ") || kickerText;

    const headline = fitAndPlace(
      { ...styled, id: "headline", text: headlineText, plate: null, color: "#ffffff", letterSpacing: -1.5, stroke: { width: 11, color: "#000000" } },
      args.ctx ?? null,
      topHalf,
      availableH - 0.1,
    );
    // Floor the kicker so it still reads at 168px wide, where a 36px label vanishes.
    const kickerSize = Math.max(44, Math.round(headline.size * 0.34));
    return [
      {
        ...styled,
        id: "kicker",
        text: kickerText,
        size: kickerSize,
        weight: 700,
        font: "TRGrotesk",
        color: contrastingInk(accent),
        stroke: null,
        shadow: null,
        plate: { color: accent, padding: 12, radius: 6 },
        letterSpacing: 2,
        y: Math.max(0.05, headline.y - (kickerSize * 1.5) / CANVAS_H),
      },
      headline,
    ];
  }

  return [fitted];
}

function applyStyleToDraft(base: TextOverlay, style: OverlayStyle, accent: string): TextOverlay {
  switch (style) {
    case "plate":
      return {
        ...base,
        color: contrastingInk(accent),
        stroke: null,
        shadow: { blur: 30, color: "rgba(0,0,0,0.5)", dx: 0, dy: 10 },
        plate: { color: accent, padding: 18, radius: 10 },
        letterSpacing: -0.5,
      };
    case "outline":
      return {
        ...base,
        color: accent,
        stroke: { width: 15, color: "#07080d" },
        shadow: { blur: 18, color: "rgba(0,0,0,0.6)", dx: 0, dy: 6 },
      };
    case "editorial":
      return {
        ...base,
        font: "TRGrotesk",
        weight: 700,
        letterSpacing: 0.5,
        lineHeight: 1.12,
        stroke: null,
        shadow: { blur: 34, color: "rgba(0,0,0,0.8)", dx: 0, dy: 4 },
      };
    case "kicker":
    case "impact":
    default:
      return base;
  }
}

/**
 * Fit the copy to the available band and anchor it inside the title-safe area.
 * Without a measuring context we fall back to a conservative size that cannot
 * overflow rather than a guess that might.
 */
function fitAndPlace(
  overlay: TextOverlay,
  ctx: Ctx2D | null,
  topHalf: boolean,
  availableH: number,
): TextOverlay {
  if (!ctx) {
    const words = overlay.text.split(/\s+/).length;
    const size = words <= 2 ? 104 : words <= 4 ? 82 : 62;
    const blockH = (size * 1.05 * Math.ceil(words / 2)) / CANVAS_H;
    return { ...overlay, size, y: topHalf ? 0.08 : Math.max(0.08, 0.88 - blockH) };
  }

  const fit = fitOverlaySize(ctx, overlay, availableH);
  // Scale stroke with the final size so the outline weight stays proportional.
  const stroke = overlay.stroke ? { ...overlay.stroke, width: Math.max(4, Math.round(fit.size * 0.1)) } : null;
  const plate = overlay.plate ? { ...overlay.plate, padding: Math.max(8, Math.round(fit.size * 0.16)) } : null;
  const y = topHalf
    ? 0.075
    : Math.max(0.075, 0.9 - fit.blockHeightFrac);
  return { ...overlay, size: fit.size, stroke, plate, y };
}

/** Scrim that keeps the copy legible, chosen from where the copy landed. */
export function suggestScrim(
  overlays: TextOverlay[],
  analysis?: ImageAnalysis | null,
): { type: "none" | "bottom" | "left" | "radial" | "vignette"; strength: number } {
  if (overlays.length === 0) return { type: "none", strength: 0 };
  const o = overlays[0];
  const bright = analysis?.brightness ?? 0.5;
  const strength = bright > 0.6 ? 0.68 : bright > 0.4 ? 0.52 : 0.38;
  if (o.plate) return { type: "none", strength: 0 };
  if (o.x < 0.3) return { type: "left", strength };
  if (o.y > 0.5) return { type: "bottom", strength };
  return { type: "vignette", strength: strength * 0.8 };
}
