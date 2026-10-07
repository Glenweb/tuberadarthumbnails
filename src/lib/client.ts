"use client";

import type {
  CompetitorShelf,
  ImageAnalysis,
  PairScore,
  SavedWinner,
  SourceVideo,
  TextOverlay,
  ThumbnailConcept,
  ThumbnailVariant,
  TitleVariant,
} from "@/lib/db/types";
import type { Capabilities, Plan, PlanId } from "@/lib/config";

export type ApiFailure = { message: string; code: string; detail?: unknown };

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly detail?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "content-type": "application/json", ...init?.headers },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError("bad_response", `The server returned a non-JSON response (${res.status}).`);
  }
  if (!res.ok) {
    const body = json as { error?: string; code?: string; detail?: unknown } | null;
    throw new ApiError(body?.code ?? "error", body?.error ?? `Request failed (${res.status}).`, body?.detail);
  }
  return json as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T,>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T,>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form }),
};

/* ───────────────────────────── Response shapes ──────────────────────────── */

export type VariantDTO = ThumbnailVariant & {
  baseAssetUrl: string | null;
  renderAssetUrl: string | null;
};

export type MeResponse = {
  user: {
    id: string; email: string; displayName: string | null;
    plan: PlanId; creditsRemaining: number; periodStart: string;
  };
  plan: Plan;
  plans: Plan[];
  creditCosts: Record<string, number>;
  capabilities: Capabilities;
  mode: string;
  stats: { winners: number; variants: number; scores: number };
  recentLedger: { action: string; delta: number; balanceAfter: number; at: string }[];
};

export type ResolveResponse = {
  source: SourceVideo & { transcriptLength: number; thumbnailAssetUrl: string | null };
  baseline: ImageAnalysis | null;
  warnings: string[];
  creditsRemaining: number;
};

export type ShelfResponse = {
  shelf: CompetitorShelf;
  cached: boolean;
  note: string | null;
  depthLimit: number;
  imagesFetched: number;
  imagesStandIn: number;
  creditsRemaining: number;
};

export type GenerateResponse = {
  runId: string;
  variants: VariantDTO[];
  concepts: ThumbnailConcept[];
  conceptSource: "claude" | "heuristic";
  imageSource: "gemini" | "synthesized" | "mixed";
  notes: string[];
  shelfId: string | null;
  creditsRemaining: number;
};

export type TitlesResponse = {
  runId: string;
  titles: (TitleVariant & { pillar: { score: number; items: unknown[] } })[];
  source: "claude" | "heuristic";
  note?: string;
  keyword: string | null;
  creditsRemaining: number;
};

export type ScoreResponse = {
  score: PairScore;
  aiSource: "claude" | "heuristic" | "skipped";
  aiNote?: string;
  shelfKeyword: string | null;
  shelfSource: "youtube_api" | "modelled" | null;
  creditsRemaining: number;
};

export type WinnersResponse = {
  winners: (SavedWinner & {
    label: string;
    renderAssetUrl: string | null;
    overlays: TextOverlay[];
    analysis: ImageAnalysis | null;
  })[];
  planLimit: number;
};
