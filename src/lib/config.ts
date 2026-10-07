/**
 * Central runtime configuration + capability detection.
 *
 * The module is designed to degrade, never to break: each provider is optional
 * and has a deterministic local implementation behind it. `capabilities()` is
 * what the UI and /api/health read to tell the operator what is live.
 */

function env(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export const config = {
  appUrl: env("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",

  anthropic: {
    apiKey: env("ANTHROPIC_API_KEY"),
    model: env("TRT_CLAUDE_MODEL") ?? "claude-opus-5-5",
    effort: (env("TRT_CLAUDE_EFFORT") ?? "medium") as
      | "low"
      | "medium"
      | "high"
      | "xhigh"
      | "max",
  },

  gemini: {
    apiKey: env("GEMINI_API_KEY") ?? env("GOOGLE_AI_STUDIO_KEY"),
    model: env("TRT_GEMINI_IMAGE_MODEL") ?? "gemini-3-pro-image",
    fallbackModel:
      env("TRT_GEMINI_IMAGE_FALLBACK_MODEL") ?? "gemini-2.5-flash-image",
  },

  youtube: {
    apiKey: env("YOUTUBE_API_KEY"),
  },

  supabase: {
    url: env("NEXT_PUBLIC_SUPABASE_URL"),
    anonKey: env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    serviceKey: env("SUPABASE_SERVICE_ROLE_KEY"),
    bucket: env("TRT_STORAGE_BUCKET") ?? "tuberadar-thumbnails",
  },

  stripe: {
    secretKey: env("STRIPE_SECRET_KEY"),
    webhookSecret: env("STRIPE_WEBHOOK_SECRET"),
    prices: {
      creator: env("STRIPE_PRICE_THUMBS_CREATOR"),
      studio: env("STRIPE_PRICE_THUMBS_STUDIO"),
      agency: env("STRIPE_PRICE_THUMBS_AGENCY"),
    },
  },

  dev: {
    plan: (env("TRT_DEV_PLAN") ?? "studio") as PlanId,
  },
} as const;

export type PlanId = "free" | "creator" | "studio" | "agency";

export type Capabilities = {
  /** Claude is wired for title generation, concepting and pair critique. */
  claude: boolean;
  /** Gemini image model is wired for real image generation. */
  imageGen: boolean;
  /** YouTube Data API v3 is wired for competitor search + stats. */
  youtubeData: boolean;
  /** Single-video metadata always works (oEmbed, no key required). */
  youtubeOEmbed: true;
  /** Persistence target in use. */
  store: "supabase" | "local";
  /** Image analysis + scoring engine — always on, runs locally. */
  scoring: true;
  /** Server-side 1280x720 compositing — always on, runs locally. */
  rendering: true;
  billing: boolean;
};

export function capabilities(): Capabilities {
  return {
    claude: Boolean(config.anthropic.apiKey),
    imageGen: Boolean(config.gemini.apiKey),
    youtubeData: Boolean(config.youtube.apiKey),
    youtubeOEmbed: true,
    store:
      config.supabase.url && config.supabase.serviceKey ? "supabase" : "local",
    scoring: true,
    rendering: true,
    billing: Boolean(config.stripe.secretKey),
  };
}

/** Human-readable mode label for the UI badge. */
export function modeLabel(): string {
  const c = capabilities();
  if (c.claude && c.imageGen && c.youtubeData) return "Full Stack Live";
  const live = [
    c.claude && "Claude",
    c.imageGen && "Gemini",
    c.youtubeData && "YouTube Data",
  ].filter(Boolean) as string[];
  if (live.length === 0) return "Local Studio";
  return `Hybrid · ${live.join(" + ")}`;
}

/* ───────────────────────────── Plans & credits ───────────────────────────── */

export type Plan = {
  id: PlanId;
  name: string;
  priceGbp: number;
  /** Monthly credit allowance. */
  credits: number;
  features: string[];
  limits: {
    variantsPerRun: number;
    competitorDepth: number;
    savedWinners: number;
    brandKits: number;
    abTests: boolean;
    apiAccess: boolean;
  };
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "TubeRadar Core",
    priceGbp: 0,
    credits: 25,
    features: [
      "Score 1 title + thumbnail pair per day",
      "Top-5 competitor shelf preview",
      "Watermark-free download of your own uploads",
    ],
    limits: {
      variantsPerRun: 2,
      competitorDepth: 5,
      savedWinners: 5,
      brandKits: 0,
      abTests: false,
      apiAccess: false,
    },
  },
  creator: {
    id: "creator",
    name: "Thumbnails Creator",
    priceGbp: 19,
    credits: 400,
    features: [
      "Unlimited scoring + shelf simulation",
      "4 AI thumbnail variants per run",
      "Top-10 competitor shelf with niche fingerprint",
      "Title lab with 10 Claude-written variants",
      "Saved winners library",
    ],
    limits: {
      variantsPerRun: 4,
      competitorDepth: 10,
      savedWinners: 100,
      brandKits: 1,
      abTests: false,
      apiAccess: false,
    },
  },
  studio: {
    id: "studio",
    name: "Thumbnails Studio",
    priceGbp: 49,
    credits: 1500,
    features: [
      "Everything in Creator",
      "6 variants per run + regenerate-with-notes",
      "Top-20 shelf depth, multi-keyword compare",
      "Brand kits (fonts, palette, face assets)",
      "A/B swap planner + CTR lift tracking",
      "Priority render queue",
    ],
    limits: {
      variantsPerRun: 6,
      competitorDepth: 20,
      savedWinners: 1000,
      brandKits: 5,
      abTests: true,
      apiAccess: false,
    },
  },
  agency: {
    id: "agency",
    name: "Thumbnails Agency",
    priceGbp: 149,
    credits: 6000,
    features: [
      "Everything in Studio",
      "8 variants per run",
      "Unlimited channels + client workspaces",
      "White-label PDF shelf reports",
      "REST API + webhook access",
    ],
    limits: {
      variantsPerRun: 8,
      competitorDepth: 30,
      savedWinners: 100000,
      brandKits: 50,
      abTests: true,
      apiAccess: true,
    },
  },
};

/** Credit cost per metered action. Kept in one place so billing stays honest. */
export const CREDIT_COSTS = {
  /** Resolve a YouTube URL: metadata + thumbnail + analysis. */
  source_video: 1,
  /** Fetch + analyse a competitor shelf (per shelf, any depth). */
  competitor_shelf: 3,
  /** Claude-written thumbnail concepts (per batch). */
  concepts: 2,
  /** One generated image variant. */
  image_variant: 6,
  /** Server-side composite render / re-render. */
  render: 1,
  /** Claude title variant batch. */
  titles: 2,
  /** Full pair score (deterministic engine only). */
  score: 1,
  /** Full pair score with Claude critique layer. */
  score_ai: 3,
} as const;

export type CreditAction = keyof typeof CREDIT_COSTS;
