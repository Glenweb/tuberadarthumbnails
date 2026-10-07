import type { TextOverlay } from "@/lib/db/types";
import { fontById } from "./fonts";

export const CANVAS_W = 1280;
export const CANVAS_H = 720;

export type ScrimSpec = {
  type: "none" | "bottom" | "left" | "radial" | "vignette";
  strength: number;
};

/**
 * The minimum 2D context surface this module needs.
 *
 * Both the browser's CanvasRenderingContext2D and @napi-rs/canvas's
 * SKRSContext2D satisfy it, which is the point: the editor preview and the
 * server-side export run the *same* drawing code. The usual failure in
 * thumbnail tools is an editor that drifts from the exported file; sharing one
 * implementation makes that impossible by construction.
 */
export interface Ctx2D {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(a: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(t: string, x: number, y: number): void;
  strokeText(t: string, x: number, y: number): void;
  measureText(t: string): { width: number };
  setLineDash(segments: number[]): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradientLike;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasGradientLike;
  font: string;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineJoin: unknown;
  lineCap: unknown;
  miterLimit: number;
  textBaseline: unknown;
  textAlign: unknown;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  globalAlpha: number;
}

export interface CanvasGradientLike {
  addColorStop(offset: number, color: string): void;
}

export function wrapText(ctx: Ctx2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${current} ${words[i]}`;
      if (ctx.measureText(candidate).width <= maxWidth) current = candidate;
      else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
  }
  return lines;
}

function measureSpaced(ctx: Ctx2D, text: string, spacing: number): number {
  if (!spacing) return ctx.measureText(text).width;
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + spacing;
  return Math.max(0, w - spacing);
}

function drawSpaced(
  ctx: Ctx2D, text: string, x: number, y: number, spacing: number, mode: "fill" | "stroke",
) {
  if (!spacing) {
    if (mode === "fill") ctx.fillText(text, x, y);
    else ctx.strokeText(text, x, y);
    return;
  }
  let cursor = x;
  for (const ch of text) {
    if (mode === "fill") ctx.fillText(ch, cursor, y);
    else ctx.strokeText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + spacing;
  }
}

function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Geometry of a laid-out overlay, in 1280x720 space. Used for hit-testing. */
export type OverlayBox = { x: number; y: number; w: number; h: number };

export function layoutOverlay(ctx: Ctx2D, o: TextOverlay): {
  lines: string[]; widths: number[]; lineH: number; box: OverlayBox; boxX: number; boxY: number; blockW: number;
} {
  const spec = fontById(o.font);
  const content = o.uppercase ? o.text.toUpperCase() : o.text;
  const boxX = o.x * CANVAS_W;
  const boxY = o.y * CANVAS_H;
  const boxW = Math.max(40, o.w * CANVAS_W);
  const spacing = o.letterSpacing ?? 0;

  ctx.save();
  ctx.font = `${o.weight || spec.weight} ${o.size}px ${spec.id}`;
  const lines = wrapText(ctx, content, boxW - spacing * 2);
  const widths = lines.map((ln) => measureSpaced(ctx, ln, spacing));
  ctx.restore();

  const lineH = o.size * (o.lineHeight || 1.05);
  const blockW = Math.max(...widths, 1);
  const blockH = lineH * lines.length;
  const pad = o.plate ? o.plate.padding : 0;

  return {
    lines, widths, lineH, boxX, boxY, blockW,
    box: { x: boxX - pad, y: boxY - pad * 0.45, w: blockW + pad * 2, h: blockH + pad * 0.9 },
  };
}

/** Draw one text overlay. Identical on the server and in the browser. */
export function drawOverlay(ctx: Ctx2D, o: TextOverlay) {
  const spec = fontById(o.font);
  const content = o.uppercase ? o.text.toUpperCase() : o.text;
  if (!content.trim()) return;

  const spacing = o.letterSpacing ?? 0;
  const { lines, widths, lineH, boxX, boxY, blockW } = layoutOverlay(ctx, o);
  const blockH = lineH * lines.length;

  ctx.save();
  ctx.font = `${o.weight || spec.weight} ${o.size}px ${spec.id}`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  if (o.rotation) {
    const cx = boxX + (o.align === "center" ? blockW / 2 : o.align === "right" ? blockW : 0);
    ctx.translate(cx, boxY + blockH / 2);
    ctx.rotate((o.rotation * Math.PI) / 180);
    ctx.translate(-cx, -(boxY + blockH / 2));
  }

  const lineX = (i: number) => {
    const w = widths[i];
    return o.align === "center"
      ? boxX + (blockW - w) / 2
      : o.align === "right"
        ? boxX + blockW - w
        : boxX;
  };

  if (o.plate) {
    ctx.save();
    ctx.fillStyle = o.plate.color;
    for (let i = 0; i < lines.length; i++) {
      if (widths[i] <= 0) continue;
      roundRect(
        ctx,
        lineX(i) - o.plate.padding,
        boxY + i * lineH - o.plate.padding * 0.45,
        widths[i] + o.plate.padding * 2,
        lineH + o.plate.padding * 0.9,
        o.plate.radius,
      );
      ctx.fill();
    }
    ctx.restore();
  }

  for (let i = 0; i < lines.length; i++) {
    const lx = lineX(i);
    const ly = boxY + i * lineH;

    if (o.shadow) {
      ctx.save();
      ctx.shadowColor = o.shadow.color;
      ctx.shadowBlur = o.shadow.blur;
      ctx.shadowOffsetX = o.shadow.dx;
      ctx.shadowOffsetY = o.shadow.dy;
      ctx.fillStyle = o.color;
      drawSpaced(ctx, lines[i], lx, ly, spacing, "fill");
      ctx.restore();
    }

    if (o.stroke && o.stroke.width > 0) {
      ctx.save();
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.lineWidth = o.stroke.width;
      ctx.strokeStyle = o.stroke.color;
      drawSpaced(ctx, lines[i], lx, ly, spacing, "stroke");
      ctx.restore();
    }

    ctx.fillStyle = o.color;
    drawSpaced(ctx, lines[i], lx, ly, spacing, "fill");
  }

  ctx.restore();
}

export function drawScrim(ctx: Ctx2D, scrim: ScrimSpec | null | undefined) {
  if (!scrim) return;
  const s = Math.max(0, Math.min(1, scrim.strength));
  if (scrim.type === "none" || s === 0) return;
  ctx.save();
  if (scrim.type === "bottom") {
    const g = ctx.createLinearGradient(0, CANVAS_H * 0.35, 0, CANVAS_H);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${s})`);
    ctx.fillStyle = g;
  } else if (scrim.type === "left") {
    const g = ctx.createLinearGradient(0, 0, CANVAS_W * 0.72, 0);
    g.addColorStop(0, `rgba(0,0,0,${s})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
  } else if (scrim.type === "radial") {
    const g = ctx.createRadialGradient(CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.18, CANVAS_W / 2, CANVAS_H / 2, CANVAS_W * 0.68);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${s})`);
    ctx.fillStyle = g;
  } else {
    const g = ctx.createRadialGradient(CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.45, CANVAS_W / 2, CANVAS_H / 2, CANVAS_W * 0.78);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${Math.min(0.92, s * 1.1)})`);
    ctx.fillStyle = g;
  }
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.restore();
}

/** Composition guides. Preview only — never baked into a download. */
export function drawGuides(ctx: Ctx2D) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1;
  for (const f of [1 / 3, 2 / 3]) {
    ctx.beginPath(); ctx.moveTo(CANVAS_W * f, 0); ctx.lineTo(CANVAS_W * f, CANVAS_H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, CANVAS_H * f); ctx.lineTo(CANVAS_W, CANVAS_H * f); ctx.stroke();
  }
  // YouTube's duration pill covers this corner — nothing important goes here.
  ctx.fillStyle = "rgba(255,64,64,0.18)";
  ctx.fillRect(CANVAS_W - 190, CANVAS_H - 70, 170, 46);
  ctx.strokeStyle = "rgba(255,64,64,0.6)";
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(CANVAS_W - 190, CANVAS_H - 70, 170, 46);
  ctx.setLineDash([10, 6]);
  ctx.strokeStyle = "rgba(34,211,238,0.5)";
  ctx.strokeRect(48, 40, CANVAS_W - 96, CANVAS_H - 80);
  ctx.setLineDash([]);
  ctx.restore();
}
