import { capabilities, modeLabel, PLANS, CREDIT_COSTS } from "@/lib/config";
import { ENGINE_VERSION } from "@/lib/scoring";
import { ok } from "@/lib/api";

export const runtime = "nodejs";

/** Operational truth: exactly which capabilities are live right now. */
export async function GET() {
  const caps = capabilities();
  return ok({
    status: "ok",
    service: "tuberadar-thumbnails",
    mode: modeLabel(),
    engine: ENGINE_VERSION,
    capabilities: caps,
    missing: [
      !caps.claude && { key: "ANTHROPIC_API_KEY", unlocks: "Claude title generation, concepting and visual critique" },
      !caps.imageGen && { key: "GEMINI_API_KEY", unlocks: "Gemini photoreal thumbnail generation" },
      !caps.youtubeData && { key: "YOUTUBE_API_KEY", unlocks: "Live competitor shelves, view counts and channel size" },
      caps.store === "local" && { key: "NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY", unlocks: "Shared persistence and auth with the main TubeRadar SaaS" },
      !caps.billing && { key: "STRIPE_SECRET_KEY", unlocks: "Live upgrade checkout" },
    ].filter(Boolean),
    plans: Object.values(PLANS).map((p) => ({ id: p.id, name: p.name, priceGbp: p.priceGbp, credits: p.credits })),
    creditCosts: CREDIT_COSTS,
  });
}
