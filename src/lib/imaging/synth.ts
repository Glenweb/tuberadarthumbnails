import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { seededRandom } from "@/lib/util/ids";
import { CANVAS_W, CANVAS_H } from "./compose";

/**
 * Procedural thumbnail backgrounds.
 *
 * Two jobs. First, it makes the whole module usable with zero API keys — the
 * generator, editor, scorer and shelf simulator all work offline. Second, even
 * with Gemini wired up these art directions are genuinely competitive for
 * graphic-led niches (finance, tech, tutorials, listicles) where a bold field
 * plus great typography out-clicks a photoreal render.
 *
 * Output is deterministic for a given seed, so a variant always regenerates
 * byte-identically — which matters when a user wants to tweak copy without the
 * background shifting under them.
 */

export type ArtDirection =
  | "gradient-burst"
  | "duotone-spotlight"
  | "diagonal-versus"
  | "data-surge"
  | "sticker-pop"
  | "cinematic-depth";

export const ART_DIRECTIONS: { id: ArtDirection; label: string; bestFor: string }[] = [
  { id: "gradient-burst", label: "Gradient Burst", bestFor: "Hype, reveals, launches" },
  { id: "duotone-spotlight", label: "Duotone Spotlight", bestFor: "Interviews, documentary, storytelling" },
  { id: "diagonal-versus", label: "Diagonal Versus", bestFor: "Comparisons, A vs B, before/after" },
  { id: "data-surge", label: "Data Surge", bestFor: "Finance, growth, analytics, SaaS" },
  { id: "sticker-pop", label: "Sticker Pop", bestFor: "Tutorials, listicles, kids, gaming" },
  { id: "cinematic-depth", label: "Cinematic Depth", bestFor: "Travel, vlogs, mini-docs" },
];

const FALLBACK_PALETTE = ["#1d4ed8", "#f97316", "#0f172a", "#22d3ee", "#fbbf24"];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6) || "000000", 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${c(r1, r2)},${c(g1, g2)},${c(b1, b2)})`;
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Order a palette so index 0 is the darkest field and the rest are accents. */
function normalisePalette(palette: string[] | undefined): string[] {
  const valid = (palette ?? []).filter((c) => /^#?[0-9a-fA-F]{3,8}$/.test(c));
  const base = valid.length >= 3 ? valid : FALLBACK_PALETTE;
  // Ascending luminance: p[0] is the dark field, p[3] the brightest accent.
  return [...base].sort((a, b) => luminance(a) - luminance(b));
}

function grain(ctx: SKRSContext2D, rnd: () => number, amount: number) {
  // Film grain breaks up flat gradients — flat fields read as "AI slop" and
  // compress badly in YouTube's pipeline.
  ctx.save();
  ctx.globalAlpha = amount;
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * CANVAS_W;
    const y = rnd() * CANVAS_H;
    const s = 1 + rnd() * 2;
    ctx.fillStyle = rnd() > 0.5 ? "#ffffff" : "#000000";
    ctx.fillRect(x, y, s, s);
  }
  ctx.restore();
}

function bokeh(ctx: SKRSContext2D, rnd: () => number, color: string, count = 14) {
  ctx.save();
  for (let i = 0; i < count; i++) {
    const r = 18 + rnd() * 110;
    const x = rnd() * CANVAS_W;
    const y = rnd() * CANVAS_H;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(color, 0.42));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function rayBurst(ctx: SKRSContext2D, rnd: () => number, color: string, cx: number, cy: number) {
  ctx.save();
  ctx.translate(cx, cy);
  const rays = 22;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + rnd() * 0.08;
    const width = 0.035 + rnd() * 0.055;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, CANVAS_W, a - width, a + width);
    ctx.closePath();
    ctx.fillStyle = rgba(color, 0.07 + rnd() * 0.07);
    ctx.fill();
  }
  ctx.restore();
}

function subjectSilhouette(ctx: SKRSContext2D, x: number, scale: number, color: string, rim?: string) {
  // A deliberately abstract human mass: it reads as a subject at shelf size,
  // gives the composition a focal anchor, and never looks like a botched face.
  ctx.save();
  ctx.translate(x, CANVAS_H);
  ctx.scale(scale, scale);
  ctx.beginPath();
  // Torso with asymmetric shoulder line so it does not read as an avatar icon.
  ctx.moveTo(-250, 0);
  ctx.bezierCurveTo(-232, -268, -142, -372, -28, -384);
  ctx.bezierCurveTo(104, -374, 206, -286, 244, 0);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  if (rim) {
    ctx.lineWidth = 9;
    ctx.strokeStyle = rim;
    ctx.stroke();
  }
  // Head is a separate subpath, otherwise the rim stroke draws a connecting
  // line straight across the torso.
  ctx.beginPath();
  ctx.ellipse(-14, -512, 112, 136, -0.09, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  if (rim) ctx.stroke();
  ctx.restore();
}

function gradientBurst(ctx: SKRSContext2D, p: string[], rnd: () => number) {
  const g = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
  g.addColorStop(0, mix(p[0], p[1], 0.25));
  g.addColorStop(0.55, p[1]);
  g.addColorStop(1, mix(p[2] ?? p[1], p[0], 0.35));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  rayBurst(ctx, rnd, "#ffffff", CANVAS_W * 0.68, CANVAS_H * 0.42);
  bokeh(ctx, rnd, p[3] ?? "#ffffff", 16);
  const glow = ctx.createRadialGradient(
    CANVAS_W * 0.7, CANVAS_H * 0.42, 10,
    CANVAS_W * 0.7, CANVAS_H * 0.42, CANVAS_H * 0.8,
  );
  glow.addColorStop(0, rgba(p[3] ?? "#ffd166", 0.55));
  glow.addColorStop(1, rgba(p[3] ?? "#ffd166", 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // Left-side scrim keeps headline copy legible.
  const scrim = ctx.createLinearGradient(0, 0, CANVAS_W * 0.66, 0);
  scrim.addColorStop(0, rgba("#000000", 0.78));
  scrim.addColorStop(0.55, rgba("#000000", 0.3));
  scrim.addColorStop(1, rgba("#000000", 0));
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

function duotoneSpotlight(ctx: SKRSContext2D, p: string[], rnd: () => number) {
  ctx.fillStyle = p[0];
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  const spot = ctx.createRadialGradient(
    CANVAS_W * 0.72, CANVAS_H * 0.46, 20,
    CANVAS_W * 0.72, CANVAS_H * 0.46, CANVAS_W * 0.56,
  );
  spot.addColorStop(0, rgba(p[1], 0.95));
  spot.addColorStop(0.55, rgba(p[1], 0.3));
  spot.addColorStop(1, rgba(p[0], 0));
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  subjectSilhouette(ctx, CANVAS_W * 0.74, 1.02, rgba(p[0], 0.94), rgba(p[2] ?? p[1], 0.75));
  // Rim light on the subject edge.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const rim = ctx.createLinearGradient(CANVAS_W * 0.62, 0, CANVAS_W * 0.9, 0);
  rim.addColorStop(0, rgba(p[2] ?? p[1], 0));
  rim.addColorStop(0.5, rgba(p[2] ?? p[1], 0.3));
  rim.addColorStop(1, rgba(p[2] ?? p[1], 0));
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.restore();
  bokeh(ctx, rnd, p[2] ?? "#ffffff", 9);
}

function diagonalVersus(ctx: SKRSContext2D, p: string[], rnd: () => number) {
  // True corner-to-corner split: the eye reads the diagonal instantly at
  // shelf size, which is the whole point of a comparison thumbnail.
  const topX = CANVAS_W * 0.68;
  const botX = CANVAS_W * 0.34;
  ctx.fillStyle = p[1];
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(topX, 0);
  ctx.lineTo(CANVAS_W, 0);
  ctx.lineTo(CANVAS_W, CANVAS_H);
  ctx.lineTo(botX, CANVAS_H);
  ctx.closePath();
  ctx.fillStyle = p[2] ?? mix(p[1], "#ffffff", 0.3);
  ctx.fill();
  ctx.restore();

  // Radial pop behind each side so neither half reads flat.
  for (const [cx, col] of [[CANVAS_W * 0.22, p[2] ?? "#ffffff"], [CANVAS_W * 0.8, p[1]]] as [number, string][]) {
    const g = ctx.createRadialGradient(cx, CANVAS_H * 0.45, 10, cx, CANVAS_H * 0.45, CANVAS_H * 0.75);
    g.addColorStop(0, rgba(col, 0.3));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  // Jagged seam that tracks the diagonal.
  ctx.save();
  ctx.strokeStyle = p[3] ?? "#fbbf24";
  ctx.lineWidth = 16;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(topX, -10);
  const steps = 9;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const baseX = topX + (botX - topX) * t;
    ctx.lineTo(baseX + (rnd() - 0.5) * 90, t * (CANVAS_H + 10));
  }
  ctx.stroke();
  ctx.shadowColor = p[3] ?? "#fbbf24";
  ctx.shadowBlur = 45;
  ctx.stroke();
  ctx.restore();

  const scrim = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  scrim.addColorStop(0, rgba("#000000", 0.45));
  scrim.addColorStop(0.5, rgba("#000000", 0.08));
  scrim.addColorStop(1, rgba("#000000", 0.58));
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  grain(ctx, rnd, 0.05);
}

function dataSurge(ctx: SKRSContext2D, p: string[], rnd: () => number) {
  const g = ctx.createLinearGradient(0, CANVAS_H, CANVAS_W, 0);
  g.addColorStop(0, p[0]);
  g.addColorStop(1, mix(p[0], p[1], 0.55));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // Perspective grid.
  ctx.save();
  ctx.strokeStyle = rgba(p[1], 0.22);
  ctx.lineWidth = 2;
  for (let i = 0; i <= 18; i++) {
    const x = (i / 18) * CANVAS_W;
    ctx.beginPath(); ctx.moveTo(x, CANVAS_H); ctx.lineTo(CANVAS_W * 0.5 + (x - CANVAS_W * 0.5) * 0.25, CANVAS_H * 0.3); ctx.stroke();
  }
  for (let i = 1; i <= 7; i++) {
    const t = i / 7;
    const y = CANVAS_H - Math.pow(t, 1.9) * CANVAS_H * 0.7;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke();
  }
  ctx.restore();
  // Surging bars.
  const bars = 9;
  for (let i = 0; i < bars; i++) {
    const h = (0.14 + Math.pow(i / bars, 1.5) * 0.62 + rnd() * 0.05) * CANVAS_H;
    const w = CANVAS_W / (bars * 1.9);
    const x = CANVAS_W * 0.08 + i * (CANVAS_W * 0.84 / bars);
    const bg = ctx.createLinearGradient(0, CANVAS_H - h, 0, CANVAS_H);
    bg.addColorStop(0, p[2] ?? p[1]);
    bg.addColorStop(1, rgba(p[1], 0.25));
    ctx.fillStyle = bg;
    ctx.fillRect(x, CANVAS_H - h, w, h);
  }
  // Trend arrow.
  ctx.save();
  ctx.strokeStyle = p[3] ?? "#22c55e";
  ctx.lineWidth = 16;
  ctx.lineCap = "round";
  ctx.shadowColor = p[3] ?? "#22c55e";
  ctx.shadowBlur = 30;
  ctx.beginPath();
  ctx.moveTo(CANVAS_W * 0.1, CANVAS_H * 0.78);
  ctx.quadraticCurveTo(CANVAS_W * 0.5, CANVAS_H * 0.74, CANVAS_W * 0.9, CANVAS_H * 0.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(CANVAS_W * 0.9, CANVAS_H * 0.2);
  ctx.lineTo(CANVAS_W * 0.78, CANVAS_H * 0.26);
  ctx.moveTo(CANVAS_W * 0.9, CANVAS_H * 0.2);
  ctx.lineTo(CANVAS_W * 0.86, CANVAS_H * 0.34);
  ctx.stroke();
  ctx.restore();
  const scrim = ctx.createLinearGradient(0, 0, 0, CANVAS_H * 0.6);
  scrim.addColorStop(0, rgba("#000000", 0.55));
  scrim.addColorStop(1, rgba("#000000", 0));
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

function stickerPop(ctx: SKRSContext2D, p: string[], rnd: () => number) {
  const cx = CANVAS_W * 0.68;
  const cy = CANVAS_H * 0.48;
  ctx.fillStyle = p[1];
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // High-contrast alternating rings — the classic "sunburst sticker" device.
  const ringA = p[2] ?? "#ffffff";
  for (let i = 11; i >= 1; i--) {
    ctx.beginPath();
    ctx.arc(cx, cy, i * 78, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 === 0 ? rgba(ringA, 0.3) : rgba(p[0], 0.34);
    ctx.fill();
  }

  // Hard-edged accent disc gives the composition a true focal anchor.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, 196, 0, Math.PI * 2);
  ctx.fillStyle = p[3] ?? "#fde047";
  ctx.shadowColor = rgba("#000000", 0.45);
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 14;
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.lineWidth = 14;
  ctx.strokeStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, cy, 196, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Chunky confetti in the brand colours.
  for (let i = 0; i < 30; i++) {
    ctx.save();
    ctx.translate(rnd() * CANVAS_W, rnd() * CANVAS_H);
    ctx.rotate(rnd() * Math.PI);
    ctx.fillStyle = [p[2] ?? "#ffffff", p[3] ?? "#fde047", "#ffffff"][Math.floor(rnd() * 3)];
    ctx.globalAlpha = 0.9;
    const s = 16 + rnd() * 34;
    if (rnd() > 0.45) ctx.fillRect(-s / 2, -s / 5, s, s / 2.5);
    else { ctx.beginPath(); ctx.arc(0, 0, s / 2.6, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  const scrim = ctx.createLinearGradient(0, 0, CANVAS_W * 0.64, 0);
  scrim.addColorStop(0, rgba(p[0], 0.86));
  scrim.addColorStop(0.7, rgba(p[0], 0.25));
  scrim.addColorStop(1, rgba(p[0], 0));
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

function cinematicDepth(ctx: SKRSContext2D, p: string[], rnd: () => number) {
  const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  sky.addColorStop(0, mix(p[1], "#ffffff", 0.2));
  sky.addColorStop(0.45, p[1]);
  sky.addColorStop(1, p[0]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // Sun disc.
  const sunY = CANVAS_H * 0.44;
  const sun = ctx.createRadialGradient(CANVAS_W * 0.62, sunY, 4, CANVAS_W * 0.62, sunY, 220);
  sun.addColorStop(0, rgba(p[3] ?? "#ffd166", 0.95));
  sun.addColorStop(1, rgba(p[3] ?? "#ffd166", 0));
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // Layered ridges, lighter to darker for aerial depth.
  for (let layer = 0; layer < 4; layer++) {
    const t = layer / 3;
    const baseY = CANVAS_H * (0.52 + t * 0.14);
    ctx.beginPath();
    ctx.moveTo(0, CANVAS_H);
    ctx.lineTo(0, baseY);
    let x = 0;
    while (x < CANVAS_W) {
      const step = 120 + rnd() * 160;
      const peak = baseY - (40 + rnd() * 120) * (1 - t * 0.5);
      ctx.quadraticCurveTo(x + step / 2, peak, x + step, baseY + (rnd() - 0.5) * 30);
      x += step;
    }
    ctx.lineTo(CANVAS_W, CANVAS_H);
    ctx.closePath();
    ctx.fillStyle = mix(p[0], p[1], 0.42 - t * 0.12);
    ctx.fill();
  }
  grain(ctx, rnd, 0.06);
  // Anamorphic letterbox hint + bottom scrim.
  const scrim = ctx.createLinearGradient(0, CANVAS_H * 0.45, 0, CANVAS_H);
  scrim.addColorStop(0, rgba("#000000", 0));
  scrim.addColorStop(1, rgba("#000000", 0.7));
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

const RENDERERS: Record<ArtDirection, (c: SKRSContext2D, p: string[], r: () => number) => void> = {
  "gradient-burst": gradientBurst,
  "duotone-spotlight": duotoneSpotlight,
  "diagonal-versus": diagonalVersus,
  "data-surge": dataSurge,
  "sticker-pop": stickerPop,
  "cinematic-depth": cinematicDepth,
};

/** Pick an art direction from the concept's angle text. */
export function pickDirection(angle: string, seed: string): ArtDirection {
  const a = angle.toLowerCase();
  if (/\bvs\b|versus|compar|before|after|better|worse/.test(a)) return "diagonal-versus";
  if (/money|profit|growth|revenue|chart|stock|crypto|invest|data|analytic/.test(a)) return "data-surge";
  if (/step|tutorial|how|guide|tip|hack|list|beginner/.test(a)) return "sticker-pop";
  if (/travel|cinemat|landscape|journey|vlog|day in/.test(a)) return "cinematic-depth";
  if (/interview|story|secret|truth|reveal|confess|portrait/.test(a)) return "duotone-spotlight";
  if (/launch|new|hype|insane|crazy|shock|record/.test(a)) return "gradient-burst";
  const all = Object.keys(RENDERERS) as ArtDirection[];
  return all[Math.floor(seededRandom(seed)() * all.length)];
}

export async function synthesizeBase(opts: {
  seed: string;
  palette?: string[];
  direction?: ArtDirection;
  angle?: string;
}): Promise<{ buffer: Buffer; direction: ArtDirection }> {
  const direction = opts.direction ?? pickDirection(opts.angle ?? "", opts.seed);
  const rnd = seededRandom(opts.seed);
  const palette = normalisePalette(opts.palette);
  const canvas = createCanvas(CANVAS_W, CANVAS_H);
  const ctx = canvas.getContext("2d");
  RENDERERS[direction](ctx, palette, rnd);
  return { buffer: await canvas.encode("png"), direction };
}
