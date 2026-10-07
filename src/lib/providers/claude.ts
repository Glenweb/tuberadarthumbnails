import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod";
import { config } from "@/lib/config";
import type { NicheFingerprint, ThumbnailConcept } from "@/lib/db/types";
import { seededRandom } from "@/lib/util/ids";
import { TITLE_ARCHETYPES } from "@/lib/scoring/lexicon";

/**
 * Claude provider: thumbnail concepting, title variants and pair critique.
 *
 * Every call has a deterministic local fallback, so the module is fully usable
 * without an API key and degrades rather than failing when a request is
 * declined, rate-limited or times out.
 */

let client: Anthropic | null = null;
function anthropic(): Anthropic | null {
  if (!config.anthropic.apiKey) return null;
  client ??= new Anthropic({ apiKey: config.anthropic.apiKey, maxRetries: 2 });
  return client;
}

export type AiOutcome<T> = {
  data: T;
  source: "claude" | "heuristic";
  /** Populated when the model path was attempted and did not produce output. */
  note?: string;
};

/* ───────────────────────────── Schemas ──────────────────────────────────── */

const ConceptSchema = z.object({
  name: z.string().describe("Two or three word label for the concept"),
  angle: z.string().describe("One line of creative direction"),
  imagePrompt: z
    .string()
    .describe(
      "A complete prompt for an image model. Describe subject, lighting, composition, background and mood. Must leave clear empty space on one side for overlay text. No text or lettering in the image itself.",
    ),
  overlayText: z.string().describe("Two to four words of overlay copy, uppercase"),
  palette: z.array(z.string()).describe("Three to five hex colours, e.g. #1d4ed8"),
  rationale: z.string().describe("Why this should out-click the current shelf"),
  differentiator: z.string().describe("The specific gap in the shelf it exploits"),
});
const ConceptsSchema = z.object({ concepts: z.array(ConceptSchema) });

const TitleSchema = z.object({
  text: z.string(),
  archetype: z.string().describe("One of the supplied hook archetype ids"),
  rationale: z.string().describe("One sentence on why this hook works here"),
});
const TitlesSchema = z.object({ titles: z.array(TitleSchema) });

const CritiqueSchema = z.object({
  verdict: z.string().describe("Two sentences: would this win the click in this shelf, and why"),
  strengths: z.array(z.string()).describe("Two to three specific strengths"),
  risks: z.array(z.string()).describe("Two to three specific risks or weaknesses"),
  oneChange: z.string().describe("The single highest-impact change, stated as an instruction"),
});

/* ─────────────────────────── Request plumbing ───────────────────────────── */

type CallOpts = {
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[];
  maxTokens?: number;
};

async function callStructured<T>(
  schema: z.ZodType<T>,
  opts: CallOpts,
): Promise<{ data: T } | { error: string }> {
  const a = anthropic();
  if (!a) return { error: "no_api_key" };

  try {
    const res = await a.beta.messages.create({
      model: config.anthropic.model,
      max_tokens: opts.maxTokens ?? 8000,
      system: opts.system,
      messages: [{ role: "user", content: opts.content }],
      output_config: {
        effort: config.anthropic.effort,
        format: zodOutputFormat(schema as never),
      },
      // Server-side refusal fallback: on a policy decline the API re-runs the
      // same request on a fallback model inside the same call, so a borderline
      // creative brief does not simply return nothing.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    if (res.stop_reason === "refusal") {
      return { error: `refused: ${res.stop_details?.explanation ?? "policy decline"}` };
    }

    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text.trim()) return { error: "empty response" };

    const parsed = schema.safeParse(JSON.parse(text));
    if (!parsed.success) return { error: `schema mismatch: ${parsed.error.message.slice(0, 200)}` };
    return { data: parsed.data };
  } catch (err) {
    // Most specific first: the distinctions matter because a 401 is a
    // configuration problem the operator must see, while a 429 is transient.
    if (err instanceof Anthropic.AuthenticationError) return { error: "invalid ANTHROPIC_API_KEY" };
    if (err instanceof Anthropic.RateLimitError) return { error: "rate limited" };
    if (err instanceof Anthropic.APIConnectionError) return { error: "connection failed" };
    if (err instanceof Anthropic.APIError) return { error: `api ${err.status}: ${String(err.message).slice(0, 160)}` };
    return { error: err instanceof Error ? err.message.slice(0, 200) : "unknown error" };
  }
}

/** Compact, token-cheap description of the shelf for the system prompt. */
function describeShelf(fp: NicheFingerprint | null, competitorTitles: string[]): string {
  if (!fp || fp.sampleSize === 0) return "No competitor shelf data is available for this keyword.";
  return [
    `Shelf sample: ${fp.sampleSize} currently-ranking videos.`,
    `Visual conventions: ${Math.round(fp.faceRate * 100)}% lead with a face, ${Math.round(
      fp.textRate * 100,
    )}% carry overlay text, median saturation ${Math.round(
      fp.medianSaturation * 100,
    )}%, median brightness ${Math.round(fp.medianBrightness * 100)}%.`,
    `Dominant shelf colours: ${fp.dominantColors.slice(0, 5).join(", ")}.`,
    `Title conventions: median ${fp.title.medianLength} characters / ${fp.title.medianWordCount} words, ${Math.round(
      fp.title.numberRate * 100,
    )}% use a number, ${Math.round(fp.title.questionRate * 100)}% are questions.`,
    fp.title.commonBigrams.length
      ? `Overused phrases on this shelf (avoid repeating these): ${fp.title.commonBigrams.join("; ")}.`
      : "",
    competitorTitles.length
      ? `Competing titles:\n${competitorTitles.slice(0, 12).map((t, i) => `${i + 1}. ${t}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const STRATEGIST_SYSTEM = `You are the thumbnail and packaging strategist inside TubeRadar, a YouTube growth platform used by professional creators and channel managers.

You optimise for the click AND the session that follows it. A title that wins the click and loses the viewer costs the channel more than it earns, so you never write an overclaim, a fake superlative, or a promise the video cannot keep.

How you think about a search shelf:
- A thumbnail is chosen at 168x94 pixels on a phone, next to ten rivals. Anything that does not survive that downscale does not exist.
- Two forces decide the click and they pull against each other. PATTERN MATCH: a thumbnail that breaks the niche's conventions reads as off-topic and gets skipped. PATTERN INTERRUPT: a thumbnail identical to its neighbours is invisible. Match the shelf on structure (face or no face, text or no text, clarity). Break from it on surface (colour, framing, wording).
- The thumbnail and title are one unit. If the thumbnail repeats the title's words, half the cell is wasted. The thumbnail should say the thing the title could not fit.

You are concrete and specific. You never write filler like "eye-catching", "engaging" or "pop".`;

/* ─────────────────────────── Concepts ───────────────────────────────────── */

export type ConceptContext = {
  topic: string;
  keyword: string | null;
  videoTitle: string | null;
  description: string | null;
  transcript: string | null;
  fingerprint: NicheFingerprint | null;
  competitorTitles: string[];
  count: number;
  /** Operator notes for a regenerate pass. */
  notes?: string | null;
  brandPalette?: string[] | null;
};

export async function generateConcepts(
  ctx: ConceptContext,
): Promise<AiOutcome<ThumbnailConcept[]>> {
  const userBlocks: Anthropic.Beta.BetaContentBlockParam[] = [
    {
      type: "text",
      text: [
        `Design ${ctx.count} distinct thumbnail concepts.`,
        ``,
        `TOPIC: ${ctx.topic}`,
        ctx.keyword ? `TARGET SEARCH KEYWORD: ${ctx.keyword}` : "",
        ctx.videoTitle ? `CURRENT VIDEO TITLE: ${ctx.videoTitle}` : "",
        ctx.description ? `DESCRIPTION: ${ctx.description.slice(0, 900)}` : "",
        ctx.transcript ? `TRANSCRIPT EXCERPT: ${ctx.transcript.slice(0, 2500)}` : "",
        ctx.brandPalette?.length ? `BRAND PALETTE (prefer these): ${ctx.brandPalette.join(", ")}` : "",
        ctx.notes ? `OPERATOR NOTES FOR THIS PASS: ${ctx.notes}` : "",
        ``,
        `SHELF CONTEXT`,
        describeShelf(ctx.fingerprint, ctx.competitorTitles),
        ``,
        `Requirements:`,
        `- Each concept must exploit a different gap in the shelf. State the gap in "differentiator".`,
        `- "imagePrompt" goes straight to an image model: describe subject, framing, lighting, background and mood, and explicitly reserve clear empty space on the left or right for overlay copy. Never ask the image model to render text, words, letters or logos — overlay copy is composited separately and image models misspell it.`,
        `- "overlayText" is 2-4 words, uppercase, and must NOT repeat words already in the title.`,
        `- "palette" is 3-5 hex colours chosen to separate from the shelf's dominant colours.`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  const result = await callStructured(ConceptsSchema, {
    system: STRATEGIST_SYSTEM,
    content: userBlocks,
    maxTokens: 12000,
  });

  if ("data" in result && result.data.concepts.length > 0) {
    return {
      data: result.data.concepts.slice(0, ctx.count).map((c, i) => ({
        id: `concept_${i + 1}`,
        name: c.name,
        angle: c.angle,
        imagePrompt: c.imagePrompt,
        overlayText: c.overlayText.toUpperCase(),
        palette: c.palette.map((p) => (p.startsWith("#") ? p : `#${p}`)),
        rationale: c.rationale,
        differentiator: c.differentiator,
      })),
      source: "claude",
    };
  }

  return {
    data: heuristicConcepts(ctx),
    source: "heuristic",
    note: "error" in result && result.error !== "no_api_key" ? `Claude: ${result.error}` : undefined,
  };
}

/** Rule-based concepts so the generator works with no API key. */
export function heuristicConcepts(ctx: ConceptContext): ThumbnailConcept[] {
  const rnd = seededRandom(`concepts:${ctx.topic}:${ctx.keyword ?? ""}`);
  const subject = (ctx.keyword || ctx.topic || "the topic").replace(/\s+/g, " ").trim();
  const noun = subject.split(/\s+/).slice(-2).join(" ");
  // Pick a palette that separates from the shelf's dominant colours.
  const shelfColours = ctx.fingerprint?.dominantColors ?? [];
  const palettes = [
    ["#0b1020", "#2563eb", "#22d3ee", "#facc15"],
    ["#190b1f", "#c026d3", "#fb7185", "#fde047"],
    ["#06130f", "#059669", "#34d399", "#fbbf24"],
    ["#1a0a05", "#ea580c", "#fb923c", "#fef08a"],
    ["#0c0a1d", "#7c3aed", "#38bdf8", "#f5d0fe"],
    ["#141414", "#dc2626", "#f87171", "#ffffff"],
  ].filter((p) => !shelfColours.some((s) => p.includes(s.toLowerCase())));

  const recipes = [
    {
      name: "Reaction Close-Up",
      angle: `A face mid-reaction to ${noun}, shot tight`,
      prompt: `Tight editorial portrait of a person reacting with genuine surprise, head and shoulders filling the right third of the frame, dramatic key light from the left, deep clean background with strong colour separation, shallow depth of field, the entire left half of the frame left deliberately empty and uncluttered for overlay copy, high contrast, crisp detail`,
      overlay: "I WAS WRONG",
      diff: "Most of this shelf hides the presenter; a human reaction forces eye contact.",
    },
    {
      name: "Before / After Split",
      angle: `The transformation ${noun} promises, shown not told`,
      prompt: `Split-frame composition, left half showing a cluttered failing state, right half showing a clean successful state, hard vertical division down the centre, dramatic directional lighting, strongly contrasting colour grade between the two halves, no people, generous clear space along the top edge for overlay copy`,
      overlay: "BEFORE VS AFTER",
      diff: "The shelf states outcomes in words; this one proves it in one glance.",
    },
    {
      name: "Single Object Hero",
      angle: `One object that represents ${noun}, isolated and oversized`,
      prompt: `A single hero object representing the subject, oversized and centred on the right third, floating against a bold flat colour background with a soft radial glow behind it, studio product lighting, strong rim light, dramatic drop shadow, left half of the frame kept empty for overlay copy, extremely high clarity`,
      overlay: "THE ONE THING",
      diff: "A clean object hero reads instantly at 168px where busy collages collapse.",
    },
    {
      name: "Number Shock",
      angle: `Lead with the number that makes ${noun} concrete`,
      prompt: `Bold graphic composition with a strong diagonal colour field, dramatic depth and glow, abstract geometric shapes suggesting growth and scale, clean uncluttered right half reserved for a large numeral overlay, vivid saturated palette, high contrast, no text or lettering anywhere in the image`,
      overlay: "£0 → £10K",
      diff: "Specific numbers are the fastest trust signal on a crowded shelf.",
    },
    {
      name: "Warning Frame",
      angle: `The mistake people make with ${noun}`,
      prompt: `Moody high-contrast scene with a single spotlit subject against near-black surroundings, cold blue ambient light with a warm accent, heavy vignette, cinematic tension, clean negative space on the left for overlay copy, sharp focus on the subject only`,
      overlay: "STOP DOING THIS",
      diff: "A dark frame is a pattern interrupt on a shelf of bright thumbnails.",
    },
    {
      name: "Clean Explainer",
      angle: `${noun}, made obvious in one diagram`,
      prompt: `Minimal editorial illustration on a bold flat background, a simple clear diagram of three connected steps rendered as abstract geometric shapes, generous white space, confident modern design, subtle depth through soft shadows, left third kept completely clear for overlay copy, no text or labels in the image`,
      overlay: "3 STEPS",
      diff: "Calm and clear wins attention on a shelf competing on noise.",
    },
  ];

  const count = Math.max(1, Math.min(ctx.count, recipes.length));
  return Array.from({ length: count }, (_, i) => {
    const r = recipes[i];
    const palette = ctx.brandPalette?.length
      ? ctx.brandPalette
      : palettes[Math.floor(rnd() * palettes.length)] ?? palettes[0];
    return {
      id: `concept_${i + 1}`,
      name: r.name,
      angle: r.angle,
      imagePrompt: `${r.prompt}. Subject matter: ${subject}. Photographic, professional, 16:9.`,
      overlayText: r.overlay,
      palette,
      rationale: `${r.angle}. Built to read at shelf size and to pair with a title that carries the detail.`,
      differentiator: r.diff,
    };
  });
}

/* ───────────────────────────── Titles ───────────────────────────────────── */

export type TitleContext = {
  topic: string;
  keyword: string | null;
  currentTitle: string | null;
  transcript: string | null;
  fingerprint: NicheFingerprint | null;
  competitorTitles: string[];
  count: number;
  archetype?: string | null;
  notes?: string | null;
};

export async function generateTitles(
  ctx: TitleContext,
): Promise<AiOutcome<{ text: string; archetype: string; rationale: string }[]>> {
  const result = await callStructured(TitlesSchema, {
    system: STRATEGIST_SYSTEM,
    content: [
      {
        type: "text",
        text: [
          `Write ${ctx.count} title variants.`,
          ``,
          `TOPIC: ${ctx.topic}`,
          ctx.keyword ? `TARGET SEARCH KEYWORD: ${ctx.keyword} — it must appear, ideally in the first 30 characters.` : "",
          ctx.currentTitle ? `CURRENT TITLE: ${ctx.currentTitle}` : "",
          ctx.transcript ? `TRANSCRIPT EXCERPT: ${ctx.transcript.slice(0, 2500)}` : "",
          ctx.archetype ? `Lean into this archetype for most variants: ${ctx.archetype}` : "",
          ctx.notes ? `OPERATOR NOTES: ${ctx.notes}` : "",
          ``,
          `SHELF CONTEXT`,
          describeShelf(ctx.fingerprint, ctx.competitorTitles),
          ``,
          `Archetype ids to choose from: ${TITLE_ARCHETYPES.map((a) => a.id).join(", ")}.`,
          ``,
          `Requirements:`,
          `- 34 to 62 characters. The first 48 characters are what mobile shows — the hook must land inside them.`,
          `- Cover at least five different archetypes across the set.`,
          `- Every title must be deliverable by the actual video. No overclaims, no "you won't believe".`,
          `- Do not reuse the overused shelf phrases listed above.`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    maxTokens: 8000,
  });

  if ("data" in result && result.data.titles.length > 0) {
    return { data: result.data.titles.slice(0, ctx.count), source: "claude" };
  }
  return {
    data: heuristicTitles(ctx),
    source: "heuristic",
    note: "error" in result && result.error !== "no_api_key" ? `Claude: ${result.error}` : undefined,
  };
}

export function heuristicTitles(ctx: TitleContext) {
  const subject = (ctx.keyword || ctx.topic || "this").trim();
  const noun = subject.split(/\s+/).slice(-3).join(" ");
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);
  const rnd = seededRandom(`titles:${subject}`);
  const n = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo));
  const year = new Date().getFullYear();

  const pool = [
    { text: `Why ${noun} stopped working (and what replaced it)`, archetype: "curiosity-gap" },
    { text: `${n(3, 9)} ${noun} mistakes costing you money`, archetype: "number-outcome" },
    { text: `I tried ${noun} for ${n(14, 90)} days — honest results`, archetype: "authority-proof" },
    { text: `Stop doing ${noun} like this`, archetype: "mistake-warning" },
    { text: `${Noun}: the beginner guide I wish I'd had`, archetype: "insider" },
    { text: `${Noun} in ${n(6, 20)} minutes, start to finish`, archetype: "speed-promise" },
    { text: `Everyone's wrong about ${noun}. Here's why`, archetype: "contrarian" },
    { text: `${Noun} vs the alternative: the honest answer`, archetype: "versus" },
    { text: `Every ${noun} method, ranked worst to best`, archetype: "listicle-rank" },
    { text: `What ${n(2, 10)} years of ${noun} actually taught me`, archetype: "authority-proof" },
    { text: `The ${noun} setup that finally worked (${year})`, archetype: "transformation" },
    { text: `${Noun}: what nobody tells you before you start`, archetype: "insider" },
  ];

  return pool.slice(0, ctx.count).map((p) => {
    const meta = TITLE_ARCHETYPES.find((a) => a.id === p.archetype);
    return {
      text: p.text,
      archetype: p.archetype,
      rationale: meta
        ? `${meta.label}: ${meta.pattern}. Keeps the keyword near the front and opens a loop the video can close.`
        : "Keyword-forward hook with an open loop.",
    };
  });
}

/* ─────────────────────────── Pair critique ──────────────────────────────── */

export type CritiqueContext = {
  title: string;
  keyword: string | null;
  imageBase64: string | null;
  imageMime: string;
  /** Competitor thumbnails to put side by side with the candidate. */
  shelfImages?: { base64: string; mime: string; title: string }[];
  fingerprint: NicheFingerprint | null;
  deterministicSummary: string;
};

export async function critiquePair(
  ctx: CritiqueContext,
): Promise<AiOutcome<{ verdict: string; strengths: string[]; risks: string[]; oneChange: string }>> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];

  if (ctx.imageBase64) {
    content.push({
      type: "text",
      text: "CANDIDATE THUMBNAIL — this is the image being judged:",
    });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: ctx.imageMime as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
        data: ctx.imageBase64,
      },
    });
  }

  // Showing the actual shelf is what makes this a comparison rather than a
  // generic critique — the model sees what the candidate sits next to.
  for (const img of (ctx.shelfImages ?? []).slice(0, 4)) {
    content.push({ type: "text", text: `COMPETITOR (currently ranking): ${img.title}` });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mime as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
        data: img.base64,
      },
    });
  }

  content.push({
    type: "text",
    text: [
      `CANDIDATE TITLE: ${ctx.title}`,
      ctx.keyword ? `TARGET KEYWORD: ${ctx.keyword}` : "",
      ``,
      `MEASURED SIGNALS (from pixel analysis — treat as ground truth, do not re-estimate them):`,
      ctx.deterministicSummary,
      ``,
      `Judge this pair as it will be seen: a 168x94 cell on a phone, next to the competitors above.`,
      `Be specific and concrete. "oneChange" must be an instruction someone can act on in five minutes.`,
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const result = await callStructured(CritiqueSchema, {
    system: STRATEGIST_SYSTEM,
    content,
    maxTokens: 6000,
  });

  if ("data" in result) return { data: result.data, source: "claude" };
  return {
    data: {
      verdict:
        "Scored by the deterministic engine only. Add ANTHROPIC_API_KEY to layer Claude's visual read on top of the measured signals.",
      strengths: [],
      risks: [],
      oneChange: "Work the ranked fix list — it is ordered by the points each change is worth.",
    },
    source: "heuristic",
    note: "error" in result && result.error !== "no_api_key" ? `Claude: ${result.error}` : undefined,
  };
}
