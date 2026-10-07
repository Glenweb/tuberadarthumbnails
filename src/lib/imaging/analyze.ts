import sharp from "sharp";
import type { ImageAnalysis } from "@/lib/db/types";
import { clamp } from "@/lib/util/text";

/** Working resolution for full-size analysis — fast and stable. */
const W = 320;
const H = 180;
/** The actual cell a thumbnail occupies in the YouTube mobile search shelf. */
const SHELF_W = 168;
const SHELF_H = 94;
const BLOCK = 16;

type Raw = { data: Uint8Array; w: number; h: number };

async function toRaw(buf: Buffer, w: number, h: number): Promise<Raw> {
  const { data, info } = await sharp(buf)
    .resize(w, h, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), w: info.width, h: info.height };
}

function luma(r: number, g: number, b: number): number {
  // Rec.709 relative luminance on 0-255 input.
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function lumaPlane({ data, w, h }: Raw): Float32Array {
  const out = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 3, p++) {
    out[p] = luma(data[i], data[i + 1], data[i + 2]);
  }
  return out;
}

function meanStd(values: Float32Array | number[]): { mean: number; std: number } {
  let sum = 0;
  const n = values.length;
  for (let i = 0; i < n; i++) sum += values[i];
  const mean = n ? sum / n : 0;
  let acc = 0;
  for (let i = 0; i < n; i++) acc += (values[i] - mean) ** 2;
  return { mean, std: n ? Math.sqrt(acc / n) : 0 };
}

/** Sobel magnitude plane, normalised to 0-1. */
function sobel(l: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = l[i - w - 1], t = l[i - w], tr = l[i - w + 1];
      const ml = l[i - 1], mr = l[i + 1];
      const bl = l[i + w - 1], bo = l[i + w], br = l[i + w + 1];
      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * t - tr + bl + 2 * bo + br;
      out[i] = Math.min(1, Math.hypot(gx, gy) / 4);
    }
  }
  return out;
}

function edgeDensity(mag: Float32Array, threshold = 0.18): number {
  let hits = 0;
  for (let i = 0; i < mag.length; i++) if (mag[i] > threshold) hits++;
  return hits / mag.length;
}

/**
 * Otsu separability for a block of luminance values: between-class variance
 * over total variance, 0-1. Text sits on a plate or stroke, so its luminance
 * histogram is strongly bimodal — this is what separates real overlay copy from
 * busy photographic texture, which has high edge energy but low separability.
 */
function otsuSeparability(values: number[]): number {
  const bins = new Array(32).fill(0);
  for (const v of values) bins[Math.min(31, Math.max(0, Math.round(v * 31)))]++;
  const total = values.length;
  if (total === 0) return 0;
  const { std } = meanStd(values);
  const totalVar = std * std;
  if (totalVar < 1e-6) return 0;

  let sumAll = 0;
  for (let i = 0; i < 32; i++) sumAll += (i / 31) * bins[i];
  let wB = 0;
  let sumB = 0;
  let best = 0;
  for (let t = 0; t < 32; t++) {
    wB += bins[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += (t / 31) * bins[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = (wB / total) * (wF / total) * (mB - mF) ** 2;
    if (between > best) best = between;
  }
  return clamp(best / totalVar);
}

/** Count of perceptually distinct colours present above a noise floor. */
function distinctColors(raw: Raw): number {
  const bins = new Map<number, number>();
  for (let i = 0; i < raw.data.length; i += 3) {
    const key =
      ((raw.data[i] >> 4) << 8) | ((raw.data[i + 1] >> 4) << 4) | (raw.data[i + 2] >> 4);
    bins.set(key, (bins.get(key) ?? 0) + 1);
  }
  const floor = (raw.w * raw.h) * 0.001;
  let n = 0;
  for (const c of bins.values()) if (c >= floor) n++;
  return n;
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("")}`;
}

/** Top dominant colours via coarse quantisation then centroid refinement. */
function dominantColors(raw: Raw, k = 5): string[] {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < raw.data.length; i += 3) {
    const r = raw.data[i], g = raw.data[i + 1], b = raw.data[i + 2];
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const cur = bins.get(key);
    if (cur) {
      cur.n++; cur.r += r; cur.g += g; cur.b += b;
    } else {
      bins.set(key, { n: 1, r, g, b });
    }
  }
  return [...bins.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, k)
    .map((c) => toHex(c.r / c.n, c.g / c.n, c.b / c.n));
}

function rgbToHsv(r: number, g: number, b: number) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/**
 * Skin-tone detection: the intersection of the classic RGB rule and a YCbCr
 * chroma box. Cheap, no model weights, and reliable enough to tell us whether
 * a thumbnail leads with a human face — which is the single biggest
 * convention variable between niches.
 */
function isSkin(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const rgbRule =
    r > 95 && g > 40 && b > 20 && max - min > 15 && Math.abs(r - g) > 15 && r > g && r > b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  const ycbcrRule = cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
  return rgbRule && ycbcrRule;
}

/** Gini coefficient of a distribution: 1 = all mass in one cell, 0 = uniform. */
function gini(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const total = s.reduce((a, b) => a + b, 0);
  if (n === 0 || total === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * s[i];
  return clamp((2 * cum) / (n * total) - (n + 1) / n);
}

/**
 * Full visual analysis of a thumbnail.
 *
 * Everything here is measured from pixels — no model calls — so scoring is
 * deterministic, free, instant, and identical for the user's candidate and for
 * every competitor thumbnail we compare it against. That symmetry is what makes
 * shelf ranking meaningful.
 */
export async function analyzeImage(buf: Buffer): Promise<ImageAnalysis> {
  const meta = await sharp(buf).metadata();
  const [full, shelf] = await Promise.all([
    toRaw(buf, W, H),
    toRaw(buf, SHELF_W, SHELF_H),
  ]);

  const l = lumaPlane(full);
  const { mean: brightness, std: contrast } = meanStd(l);
  const mag = sobel(l, full.w, full.h);
  const edges = edgeDensity(mag);

  // Colour statistics in one pass.
  let satSum = 0;
  let skin = 0;
  const rg: number[] = [];
  const yb: number[] = [];
  const hue = new Array(12).fill(0);
  let hueWeight = 0;
  // Skin mass grid for face-region localisation.
  const GX = 16, GY = 9;
  const skinGrid = new Array(GX * GY).fill(0);

  for (let y = 0; y < full.h; y++) {
    for (let x = 0; x < full.w; x++) {
      const i = (y * full.w + x) * 3;
      const r = full.data[i], g = full.data[i + 1], b = full.data[i + 2];
      const hsv = rgbToHsv(r, g, b);
      satSum += hsv.s;
      rg.push(r - g);
      yb.push(0.5 * (r + g) - b);
      const wgt = hsv.s * hsv.v;
      if (wgt > 0.05) {
        hue[Math.min(11, Math.floor(hsv.h / 30))] += wgt;
        hueWeight += wgt;
      }
      if (isSkin(r, g, b)) {
        skin++;
        const gx = Math.min(GX - 1, Math.floor((x / full.w) * GX));
        const gy = Math.min(GY - 1, Math.floor((y / full.h) * GY));
        skinGrid[gy * GX + gx]++;
      }
    }
  }

  const px = full.w * full.h;
  const saturation = satSum / px;
  const skinRatio = skin / px;
  const rgStats = meanStd(rg);
  const ybStats = meanStd(yb);
  const colorfulnessRaw =
    Math.hypot(rgStats.std, ybStats.std) + 0.3 * Math.hypot(rgStats.mean, ybStats.mean);
  const colorfulness = clamp(colorfulnessRaw / 110);
  const hueHistogram = hueWeight > 0 ? hue.map((v) => v / hueWeight) : hue.map(() => 0);

  // ── Face region: densest contiguous run of skin-heavy grid cells ──
  let faceRegion: ImageAnalysis["faceRegion"] = null;
  if (skinRatio > 0.012) {
    const cellPx = (full.w / GX) * (full.h / GY);
    const hot = skinGrid.map((v) => v / cellPx > 0.22);
    let best: { x0: number; y0: number; x1: number; y1: number; mass: number } | null = null;
    const seen = new Array(GX * GY).fill(false);
    for (let gy = 0; gy < GY; gy++) {
      for (let gx = 0; gx < GX; gx++) {
        const idx = gy * GX + gx;
        if (!hot[idx] || seen[idx]) continue;
        // Flood fill this blob.
        const stack = [idx];
        seen[idx] = true;
        let x0 = gx, x1 = gx, y0 = gy, y1 = gy, mass = 0;
        while (stack.length) {
          const cur = stack.pop()!;
          const cx = cur % GX;
          const cy = Math.floor(cur / GX);
          mass += skinGrid[cur];
          x0 = Math.min(x0, cx); x1 = Math.max(x1, cx);
          y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= GX || ny >= GY) continue;
            const ni = ny * GX + nx;
            if (hot[ni] && !seen[ni]) { seen[ni] = true; stack.push(ni); }
          }
        }
        if (!best || mass > best.mass) best = { x0, y0, x1, y1, mass };
      }
    }
    if (best && best.mass / px > 0.01) {
      faceRegion = {
        x: best.x0 / GX,
        y: best.y0 / GY,
        w: (best.x1 - best.x0 + 1) / GX,
        h: (best.y1 - best.y0 + 1) / GY,
      };
    }
  }

  // ── Overlay-text mass: high edge energy + bimodal luminance + flat palette ──
  const bx = Math.floor(full.w / BLOCK);
  const by = Math.floor(full.h / BLOCK);
  const textBlocks: boolean[] = new Array(bx * by).fill(false);
  let textCount = 0;
  for (let b = 0; b < by; b++) {
    for (let a = 0; a < bx; a++) {
      const vals: number[] = [];
      let eSum = 0;
      const hues = new Set<number>();
      for (let y = b * BLOCK; y < (b + 1) * BLOCK; y++) {
        for (let x = a * BLOCK; x < (a + 1) * BLOCK; x++) {
          const i = y * full.w + x;
          vals.push(l[i]);
          eSum += mag[i];
          const p = i * 3;
          hues.add(((full.data[p] >> 5) << 6) | ((full.data[p + 1] >> 5) << 3) | (full.data[p + 2] >> 5));
        }
      }
      const eAvg = eSum / vals.length;
      const sep = otsuSeparability(vals);
      const { std } = meanStd(vals);
      const flatPalette = hues.size <= 12;
      if (eAvg > 0.09 && sep > 0.62 && std > 0.14 && flatPalette) {
        textBlocks[b * bx + a] = true;
        textCount++;
      }
    }
  }
  const textCoverage = textCount / (bx * by);
  let textRegion: ImageAnalysis["textRegion"] = null;
  if (textCount > 0) {
    let x0 = bx, x1 = -1, y0 = by, y1 = -1;
    for (let b = 0; b < by; b++) {
      for (let a = 0; a < bx; a++) {
        if (!textBlocks[b * bx + a]) continue;
        x0 = Math.min(x0, a); x1 = Math.max(x1, a);
        y0 = Math.min(y0, b); y1 = Math.max(y1, b);
      }
    }
    textRegion = { x: x0 / bx, y: y0 / by, w: (x1 - x0 + 1) / bx, h: (y1 - y0 + 1) / by };
  }

  // ── Focal point + concentration from edge energy over a 12x7 grid ──
  const FX = 12, FY = 7;
  const energy = new Array(FX * FY).fill(0);
  let wx = 0, wy = 0, wTotal = 0;
  for (let y = 0; y < full.h; y++) {
    for (let x = 0; x < full.w; x++) {
      const e = mag[y * full.w + x];
      if (e <= 0.12) continue;
      energy[Math.min(FY - 1, Math.floor((y / full.h) * FY)) * FX + Math.min(FX - 1, Math.floor((x / full.w) * FX))] += e;
      wx += x * e; wy += y * e; wTotal += e;
    }
  }
  const focalPoint =
    wTotal > 0
      ? { x: clamp(wx / wTotal / full.w), y: clamp(wy / wTotal / full.h) }
      : { x: 0.5, y: 0.5 };
  const focalConcentration = gini(energy);

  // ── Shelf-size survival: what is left at 168x94 ──
  const sl = lumaPlane(shelf);
  const { std: shelfContrast } = meanStd(sl);
  const shelfEdges = edgeDensity(sobel(sl, shelf.w, shelf.h), 0.18);
  const shelfDetailRetention = edges > 0 ? clamp(shelfEdges / edges) : 0;

  return {
    width: meta.width ?? W,
    height: meta.height ?? H,
    contrast: Number(contrast.toFixed(4)),
    brightness: Number(brightness.toFixed(4)),
    saturation: Number(saturation.toFixed(4)),
    colorfulness: Number(colorfulness.toFixed(4)),
    edgeDensity: Number(edges.toFixed(4)),
    skinRatio: Number(skinRatio.toFixed(4)),
    faceRegion,
    textCoverage: Number(textCoverage.toFixed(4)),
    textRegion,
    focalPoint: { x: Number(focalPoint.x.toFixed(3)), y: Number(focalPoint.y.toFixed(3)) },
    focalConcentration: Number(focalConcentration.toFixed(4)),
    shelfContrast: Number(shelfContrast.toFixed(4)),
    shelfDetailRetention: Number(shelfDetailRetention.toFixed(4)),
    hueHistogram: hueHistogram.map((v) => Number(v.toFixed(4))),
    dominantColors: dominantColors(full),
    distinctColors: distinctColors(full),
  };
}

/** Normalise any image to a clean 1280x720 JPEG/PNG buffer. */
export async function normalizeTo1280x720(
  buf: Buffer,
  format: "png" | "jpeg" = "png",
): Promise<Buffer> {
  const pipeline = sharp(buf).resize(1280, 720, { fit: "cover", position: "centre" });
  return format === "png"
    ? pipeline.png({ compressionLevel: 9 }).toBuffer()
    : pipeline.jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
}
