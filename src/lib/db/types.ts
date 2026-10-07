/**
 * Data model for the TubeRadar Thumbnails module.
 *
 * Every table is prefixed `trt_` so it can live inside the existing TubeRadar
 * Supabase schema without colliding with core tables. `user_id` always points
 * at `auth.users.id`, which is how the module inherits TubeRadar auth.
 */

import type { PlanId } from "@/lib/config";

export type ID = string;
export type ISODate = string;

/* ───────────────────────────────── Account ───────────────────────────────── */

export type TrtUser = {
  id: ID;
  email: string;
  display_name: string | null;
  /** Thumbnails upgrade tier. `free` = TubeRadar Core, no upgrade. */
  plan: PlanId;
  /** Credits remaining in the current period. */
  credits_remaining: number;
  /** Start of the current billing period, used for the monthly top-up. */
  period_start: ISODate;
  stripe_customer_id: string | null;
  created_at: ISODate;
};

export type CreditLedgerEntry = {
  id: ID;
  user_id: ID;
  /** Negative for spend, positive for grant/refund. */
  delta: number;
  action: string;
  balance_after: number;
  note: string | null;
  created_at: ISODate;
};

/* ───────────────────────────────── Channels ──────────────────────────────── */

export type Channel = {
  id: ID;
  user_id: ID;
  youtube_channel_id: string | null;
  title: string;
  handle: string | null;
  subscriber_count: number | null;
  avatar_url: string | null;
  /** Brand kit — drives overlay defaults so variants stay on-brand. */
  brand: BrandKit | null;
  created_at: ISODate;
};

export type BrandKit = {
  palette: string[];
  font: string;
  /** Default overlay text treatment. */
  textStyle: "block" | "outline" | "highlight" | "shadow";
  logoUrl?: string | null;
};

/* ─────────────────────────────── Source videos ───────────────────────────── */

export type SourceVideo = {
  id: ID;
  user_id: ID;
  channel_id: ID | null;
  /** YouTube video id, null when the source was a bare prompt. */
  youtube_id: string | null;
  url: string | null;
  title: string | null;
  description: string | null;
  /** Target search keyword this video competes for. */
  keyword: string | null;
  thumbnail_url: string | null;
  /** Locally cached copy of the original thumbnail, as an asset id. */
  thumbnail_asset_id: ID | null;
  channel_title: string | null;
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
  duration_seconds: number | null;
  published_at: ISODate | null;
  tags: string[] | null;
  /** Transcript text when retrievable; drives concept grounding. */
  transcript: string | null;
  transcript_source: "timedtext" | "none";
  /** Analysis of the ORIGINAL thumbnail, so we can show the lift we add. */
  baseline_analysis: ImageAnalysis | null;
  created_at: ISODate;
};

/* ─────────────────────────────── Competitors ─────────────────────────────── */

export type CompetitorVideo = {
  youtube_id: string;
  title: string;
  channel_title: string;
  channel_id: string | null;
  thumbnail_url: string;
  view_count: number | null;
  subscriber_count: number | null;
  published_at: ISODate | null;
  /** Position in the search result shelf, 1-based. */
  rank: number;
  /** Views per day since publish — our velocity proxy. */
  velocity: number | null;
  analysis: ImageAnalysis | null;
  /** Score of this competitor under the same engine, for shelf ranking. */
  score: number | null;
};

export type CompetitorShelf = {
  id: ID;
  user_id: ID;
  keyword: string;
  region: string;
  source: "youtube_api" | "modelled";
  videos: CompetitorVideo[];
  fingerprint: NicheFingerprint;
  created_at: ISODate;
};

/** Aggregate visual + linguistic signature of a niche's top-ranking shelf. */
export type NicheFingerprint = {
  sampleSize: number;
  /** 0-1 share of competitor thumbnails with a detected face region. */
  faceRate: number;
  /** 0-1 share with significant overlay text. */
  textRate: number;
  medianTextCoverage: number;
  medianSaturation: number;
  medianBrightness: number;
  medianContrast: number;
  medianColorfulness: number;
  medianEdgeDensity: number;
  /** 12-bin hue histogram, normalised. */
  hueHistogram: number[];
  dominantColors: string[];
  title: {
    medianLength: number;
    numberRate: number;
    bracketRate: number;
    allCapsWordRate: number;
    questionRate: number;
    medianWordCount: number;
    commonTokens: string[];
    commonBigrams: string[];
  };
  /** Median TRC score of the shelf — the bar you have to clear. */
  medianScore: number;
  /** Views-per-day quartiles, used to calibrate the CTR band. */
  velocity: { p25: number; p50: number; p75: number } | null;
};

/* ──────────────────────────── Image analysis ─────────────────────────────── */

export type ImageAnalysis = {
  width: number;
  height: number;
  /** RMS luminance contrast, 0-1. */
  contrast: number;
  /** Mean luminance, 0-1. */
  brightness: number;
  /** Mean saturation, 0-1. */
  saturation: number;
  /** Hasler-Süsstrunk colourfulness, normalised 0-1. */
  colorfulness: number;
  /** Sobel edge density, 0-1 — a clutter proxy. */
  edgeDensity: number;
  /** Share of pixels in a skin-tone cluster. */
  skinRatio: number;
  /** Detected face-ish region, normalised coords, null when none. */
  faceRegion: { x: number; y: number; w: number; h: number } | null;
  /** Share of pixels that look like high-contrast overlay text. */
  textCoverage: number;
  /** Where the text mass sits. */
  textRegion: { x: number; y: number; w: number; h: number } | null;
  /** Centre of visual mass (edge-energy weighted), normalised. */
  focalPoint: { x: number; y: number };
  /** How concentrated the edge energy is: 1 = one clear subject, 0 = noise. */
  focalConcentration: number;
  /** Contrast retained after downscaling to the 168x94 mobile shelf cell. */
  shelfContrast: number;
  /** Detail retained at shelf size, 0-1. */
  shelfDetailRetention: number;
  /** 12-bin hue histogram, normalised. */
  hueHistogram: number[];
  dominantColors: string[];
  /** Count of perceptually distinct colours (clutter + print-ability proxy). */
  distinctColors: number;
};

/* ───────────────────────────────── Variants ──────────────────────────────── */

export type TextOverlay = {
  id: string;
  text: string;
  /** Normalised 0-1 position of the text box's top-left. */
  x: number;
  y: number;
  /** Normalised width of the text box. */
  w: number;
  /** Font size in px at 1280x720. */
  size: number;
  font: string;
  weight: number;
  color: string;
  align: "left" | "center" | "right";
  uppercase: boolean;
  letterSpacing: number;
  lineHeight: number;
  stroke: { width: number; color: string } | null;
  shadow: { blur: number; color: string; dx: number; dy: number } | null;
  /** Solid or gradient plate behind the text. */
  plate: { color: string; padding: number; radius: number } | null;
  rotation: number;
};

export type ThumbnailVariant = {
  id: ID;
  user_id: ID;
  source_video_id: ID | null;
  /** Group id so a batch of variants from one run stays together. */
  run_id: ID;
  label: string;
  /** Concept that produced it. */
  concept: ThumbnailConcept | null;
  /** How the base image came to be. */
  origin: "generated" | "uploaded" | "youtube" | "synthesized";
  /** Asset id of the base image (no overlays). */
  base_asset_id: ID;
  /** Asset id of the flattened 1280x720 render (base + overlays). */
  render_asset_id: ID | null;
  overlays: TextOverlay[];
  analysis: ImageAnalysis | null;
  created_at: ISODate;
};

export type ThumbnailConcept = {
  id: string;
  name: string;
  /** One-line creative direction. */
  angle: string;
  /** Prompt handed to the image model. */
  imagePrompt: string;
  /** Short overlay copy, 2-5 words. */
  overlayText: string;
  /** Hex palette the concept should hit. */
  palette: string[];
  /** Why this should out-click the shelf. */
  rationale: string;
  /** Which shelf gap it exploits. */
  differentiator: string;
};

export type TitleVariant = {
  id: ID;
  user_id: ID;
  source_video_id: ID | null;
  run_id: ID;
  text: string;
  /** Hook archetype, e.g. "curiosity gap", "number + outcome". */
  archetype: string;
  rationale: string | null;
  origin: "claude" | "heuristic" | "user";
  created_at: ISODate;
};

/* ───────────────────────────────── Scoring ───────────────────────────────── */

export type ScoreBreakdownItem = {
  key: string;
  label: string;
  /** 0-100 sub-score. */
  score: number;
  /** Weight within its pillar. */
  weight: number;
  /** Measured value, formatted for display. */
  value: string;
  /** Target band for the niche. */
  target: string;
  verdict: "strong" | "ok" | "weak";
  note: string;
};

export type ScorePillar = {
  key: "thumbnail" | "title" | "pair" | "niche";
  label: string;
  score: number;
  weight: number;
  items: ScoreBreakdownItem[];
};

export type FixSuggestion = {
  id: string;
  /** Ranked: biggest point gain first. */
  priority: number;
  pillar: ScorePillar["key"];
  title: string;
  detail: string;
  /** Estimated TRC points recovered if applied. */
  estimatedGain: number;
  /** Can the app apply this automatically? */
  autoFixable: boolean;
  autoFix?: { type: string; params: Record<string, unknown> };
};

export type PairScore = {
  id: ID;
  user_id: ID;
  variant_id: ID | null;
  title_variant_id: ID | null;
  source_video_id: ID | null;
  shelf_id: ID | null;
  /** The title that was scored. Without it a score row says nothing about
   *  what produced it, which makes the history useless for comparison. */
  title_text: string;
  /** Label of the thumbnail that was scored. */
  variant_label: string | null;
  /** Keyword the shelf was built for. */
  keyword: string | null;
  /** The headline 0-100 TubeRadar Click Index. */
  trc: number;
  grade: "S" | "A" | "B" | "C" | "D";
  pillars: ScorePillar[];
  fixes: FixSuggestion[];
  /** Simulated position in the competitor shelf. */
  shelf: {
    rank: number;
    outOf: number;
    beats: number;
    medianScore: number;
    topScore: number;
  } | null;
  /** Modelled CTR band — explicitly an estimate, never a promise. */
  ctrEstimate: {
    low: number;
    high: number;
    nicheMedian: number | null;
    confidence: "low" | "medium" | "high";
    basis: string;
  };
  /** Dual axis: fit in, stand out. */
  axes: { conventionFit: number; differentiation: number };
  /** Claude's qualitative read, when the AI layer ran. */
  critique: {
    verdict: string;
    strengths: string[];
    risks: string[];
    oneChange: string;
  } | null;
  engine_version: string;
  created_at: ISODate;
};

/* ─────────────────────────────── Saved winners ───────────────────────────── */

export type SavedWinner = {
  id: ID;
  user_id: ID;
  variant_id: ID;
  title_variant_id: ID | null;
  score_id: ID | null;
  source_video_id: ID | null;
  title_text: string;
  trc: number;
  keyword: string | null;
  notes: string | null;
  /** Operator-recorded real-world result, closes the feedback loop. */
  actual: { ctr: number | null; views: number | null; recorded_at: ISODate } | null;
  created_at: ISODate;
};

/* ──────────────────────────────── Assets ─────────────────────────────────── */

export type StoredAsset = {
  id: ID;
  user_id: ID;
  kind: "base" | "render" | "source" | "competitor";
  mime: string;
  width: number;
  height: number;
  bytes: number;
  /** Local relative path or Supabase storage key. */
  path: string;
  created_at: ISODate;
};

/* ─────────────────────────────── Store shape ─────────────────────────────── */

export type Tables = {
  users: TrtUser;
  credit_ledger: CreditLedgerEntry;
  channels: Channel;
  source_videos: SourceVideo;
  shelves: CompetitorShelf;
  variants: ThumbnailVariant;
  titles: TitleVariant;
  scores: PairScore;
  winners: SavedWinner;
  assets: StoredAsset;
};

export type TableName = keyof Tables;
