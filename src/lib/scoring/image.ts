import type { ImageAnalysis, NicheFingerprint, ScorePillar } from "@/lib/db/types";
import { band, bandScore, fmtBand, makeItem, pct, riseScore, weighted } from "./bands";
import { clamp } from "@/lib/util/text";

/**
 * Thumbnail craft pillar.
 *
 * Absolute craft constants (shelf legibility, contrast, focal clarity) are
 * niche-independent — they come from how the image is physically displayed, not
 * from taste. Niche-sensitive variables (text load, face expectation) widen or
 * narrow their band using the fingerprint when one is available.
 */
export function scoreThumbnail(
  a: ImageAnalysis,
  fp: NicheFingerprint | null,
): ScorePillar {
  /* ── Shelf legibility: the one that actually decides mobile clicks ───────
     A thumbnail is chosen at 168x94 on a phone, not at 1280x720 on your
     monitor. We measure what survives the downscale, not what looks good
     full-size. This sub-score is weighted highest for that reason. */
  const shelfContrastBand = band(0.18, 0.42, 0.05, 0.6);
  const shelfLegibility = weighted([
    { score: bandScore(a.shelfContrast, shelfContrastBand), weight: 0.6 },
    { score: riseScore(a.shelfDetailRetention, 0.25, 0.75), weight: 0.4 },
  ]);

  /* ── Contrast at full size ── */
  const contrastBand = band(0.19, 0.40, 0.06, 0.58);
  const contrastScore = bandScore(a.contrast, contrastBand);

  /* ── Focal clarity: one obvious subject beats a busy collage ── */
  const focalScore = weighted([
    { score: riseScore(a.focalConcentration, 0.25, 0.68), weight: 0.65 },
    // Edge density above the band means clutter; below means an empty frame.
    { score: bandScore(a.edgeDensity, band(0.06, 0.26, 0.015, 0.46)), weight: 0.35 },
  ]);

  /* ── Colour punch, banded against the niche when we know it ── */
  const satCentre = fp ? clamp(fp.medianSaturation, 0.22, 0.62) : 0.42;
  const satBand = band(Math.max(0.16, satCentre - 0.14), Math.min(0.82, satCentre + 0.18), 0.04, 0.95);
  const colourScore = weighted([
    { score: bandScore(a.saturation, satBand), weight: 0.5 },
    { score: bandScore(a.colorfulness, band(0.22, 0.62, 0.05, 0.9)), weight: 0.5 },
  ]);

  /* ── Composition: subject off-centre, text given its own air ── */
  const thirdsDistance = Math.min(
    Math.hypot(a.focalPoint.x - 1 / 3, a.focalPoint.y - 1 / 2),
    Math.hypot(a.focalPoint.x - 2 / 3, a.focalPoint.y - 1 / 2),
    Math.hypot(a.focalPoint.x - 1 / 3, a.focalPoint.y - 1 / 3),
    Math.hypot(a.focalPoint.x - 2 / 3, a.focalPoint.y - 2 / 3),
  );
  let compositionScore = riseScore(1 - thirdsDistance / 0.5, 0, 1);
  // Reward the classic split: subject on one side, copy on the other.
  if (a.faceRegion && a.textRegion) {
    const faceCx = a.faceRegion.x + a.faceRegion.w / 2;
    const textCx = a.textRegion.x + a.textRegion.w / 2;
    if (Math.abs(faceCx - textCx) > 0.28) compositionScore = Math.min(100, compositionScore + 18);
    else compositionScore = Math.max(0, compositionScore - 14);
  }
  // Nothing of value should sit under the duration pill.
  if (a.textRegion && a.textRegion.x + a.textRegion.w > 0.86 && a.textRegion.y + a.textRegion.h > 0.84) {
    compositionScore = Math.max(0, compositionScore - 22);
  }

  /* ── Text load, niche-aware ── */
  const nicheTextCentre = fp && fp.textRate > 0.3 ? clamp(fp.medianTextCoverage, 0.04, 0.2) : 0.1;
  const textBand = band(
    Math.max(0.02, nicheTextCentre - 0.055),
    Math.min(0.3, nicheTextCentre + 0.085),
    0,
    0.42,
  );
  // A text-free thumbnail is only a problem where the niche expects text.
  const nicheExpectsText = !fp || fp.textRate > 0.45;
  const textScore =
    a.textCoverage < 0.015 && !nicheExpectsText ? 82 : bandScore(a.textCoverage, textBand);

  /* ── Human presence, judged against the niche's own habit ── */
  const nicheFaceRate = fp?.faceRate ?? 0.5;
  const hasFace = a.faceRegion !== null;
  let faceScore: number;
  let faceNote: string;
  if (nicheFaceRate >= 0.6) {
    faceScore = hasFace ? 100 : 44;
    faceNote = hasFace
      ? "Matches a face-led shelf."
      : `${pct(nicheFaceRate)} of ranking thumbnails lead with a face — yours does not.`;
  } else if (nicheFaceRate <= 0.25) {
    faceScore = hasFace ? 88 : 92;
    faceNote = hasFace
      ? "A face is an edge here: this shelf is mostly graphic-led."
      : "Graphic-led, in line with the shelf.";
  } else {
    faceScore = hasFace ? 96 : 72;
    faceNote = hasFace ? "Face present in a mixed shelf — a safe lead." : "Mixed shelf; a face would add warmth.";
  }

  const items = [
    makeItem({
      key: "shelf_legibility",
      label: "Shelf legibility @168×94",
      score: shelfLegibility,
      weight: 0.26,
      value: `${pct(a.shelfContrast)} contrast · ${pct(a.shelfDetailRetention)} detail kept`,
      target: `${fmtBand(shelfContrastBand)} contrast · 25%+ detail`,
      note:
        shelfLegibility >= 78
          ? "Survives the mobile shelf — this is where the click is actually won."
          : "Collapses when scaled down. Increase subject size and simplify the background.",
    }),
    makeItem({
      key: "contrast",
      label: "Contrast",
      score: contrastScore,
      weight: 0.14,
      value: pct(a.contrast),
      target: fmtBand(contrastBand),
      note:
        a.contrast < contrastBand.lo
          ? "Flat tonal range — add a dark scrim or brighten the subject."
          : a.contrast > contrastBand.hi
            ? "Harsh contrast can crush detail after YouTube re-encodes it."
            : "Healthy tonal separation.",
    }),
    makeItem({
      key: "focal_clarity",
      label: "Focal clarity",
      score: focalScore,
      weight: 0.18,
      value: `${pct(a.focalConcentration)} concentration · ${pct(a.edgeDensity)} edge density`,
      target: "55%+ concentration · 6–26% edges",
      note:
        focalScore >= 78
          ? "One clear subject. The eye lands immediately."
          : "Visual energy is spread across the frame — nothing to lock onto in the half-second it gets.",
    }),
    makeItem({
      key: "colour_punch",
      label: "Colour punch",
      score: colourScore,
      weight: 0.14,
      value: `${pct(a.saturation)} saturation · ${pct(a.colorfulness)} colourfulness`,
      target: `${fmtBand(satBand)} saturation`,
      note:
        colourScore >= 78
          ? "Colour pulls weight without tipping into garish."
          : a.saturation < satBand.lo
            ? "Muted next to this shelf. Push saturation on the subject, not the whole frame."
            : "Over-saturated — reads as low-budget and loses detail in compression.",
    }),
    makeItem({
      key: "composition",
      label: "Composition",
      score: compositionScore,
      weight: 0.12,
      value: `focal point at ${pct(a.focalPoint.x)}, ${pct(a.focalPoint.y)}`,
      target: "subject on a third, copy opposite",
      note:
        compositionScore >= 78
          ? "Subject and copy occupy separate halves — the layout that reads fastest."
          : "Subject sits dead centre or overlaps the copy. Push it to a third.",
    }),
    makeItem({
      key: "text_load",
      label: "Text load",
      score: textScore,
      weight: 0.1,
      value: pct(a.textCoverage, 1),
      target: fmtBand(textBand, true, 1),
      note:
        a.textCoverage > textBand.hi
          ? "Too much copy for the cell. Cut to 3–4 words set much larger."
          : a.textCoverage < textBand.lo && nicheExpectsText
            ? "Little or no overlay text where this shelf expects it."
            : "Text mass is in the right range for this shelf.",
    }),
    makeItem({
      key: "human_presence",
      label: "Human presence",
      score: faceScore,
      weight: 0.06,
      value: hasFace ? `face region ${pct(a.faceRegion!.w)}×${pct(a.faceRegion!.h)}` : "none detected",
      target: fp ? `niche face rate ${pct(nicheFaceRate)}` : "niche-dependent",
      note: faceNote,
    }),
  ];

  return {
    key: "thumbnail",
    label: "Thumbnail craft",
    score: Math.round(weighted(items)),
    weight: 0.35,
    items,
  };
}
