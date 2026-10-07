"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PairScore } from "@/lib/db/types";
import { api, type MeResponse } from "@/lib/client";
import { Banner, Empty, PageHeader, Section, Spinner, Stat } from "@/components/ui";
import { scoreColour } from "@/components/score/ScoreVisuals";

const ACTIONS = [
  {
    href: "/score",
    title: "Score what you already made",
    body: "Drop in a finished thumbnail and the title you were about to publish. Get its shelf position before you commit.",
    cta: "Open the scorer",
    tone: "accent" as const,
  },
  {
    href: "/studio",
    title: "Generate from a URL or an idea",
    body: "We read the competitor shelf first, then design variants against it — concepts, images, overlays and scoring in one pass.",
    cta: "Open the studio",
    tone: "primary" as const,
  },
  {
    href: "/competitors",
    title: "Read a shelf before you design",
    body: "Face rate, text rate, colour ownership and the quality bar for any keyword. Know the conventions before you break them.",
    cta: "Analyse a shelf",
    tone: "ghost" as const,
  },
];

export function OverviewClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [scores, setScores] = useState<PairScore[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<MeResponse>("/api/me").then(setMe).catch((e) => setError(e.message));
    api.get<{ scores: PairScore[] }>("/api/score?limit=8").then((d) => setScores(d.scores)).catch(() => undefined);
  }, []);

  const caps = me?.capabilities;
  const missing = caps
    ? [
        !caps.claude && { key: "ANTHROPIC_API_KEY", unlocks: "Claude-written titles, concepts and visual critique" },
        !caps.imageGen && { key: "GEMINI_API_KEY", unlocks: "Photoreal AI thumbnail generation" },
        !caps.youtubeData && { key: "YOUTUBE_API_KEY", unlocks: "Live competitor shelves and channel stats" },
        caps.store === "local" && { key: "SUPABASE_*", unlocks: "Shared persistence and auth with the main TubeRadar SaaS" },
      ].filter(Boolean as unknown as (v: unknown) => v is { key: string; unlocks: string })
    : [];

  return (
    <div className="mx-auto max-w-[1340px] p-5 sm:p-7">
      <PageHeader
        eyebrow="TubeRadar Thumbnails"
        title="Stop guessing which thumbnail wins"
        subtitle="Most thumbnail tools score an image in a vacuum. This one scores the pair — thumbnail and title together — against the exact result shelf it will sit in, at the 168×94 size that actually decides the click, and tells you where you would rank."
      />

      {error && <div className="mb-4"><Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner></div>}

      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        {ACTIONS.map((a) => (
          <article key={a.href} className="panel p-5 flex flex-col">
            <h2 className="text-[15px] font-extrabold tracking-tight">{a.title}</h2>
            <p className="mt-2 flex-1 text-[12.5px] leading-relaxed text-ink-300">{a.body}</p>
            <Link
              href={a.href}
              className={`btn mt-4 self-start ${a.tone === "primary" ? "btn-primary" : a.tone === "accent" ? "btn-accent" : "btn-ghost"}`}
            >
              {a.cta}
            </Link>
          </article>
        ))}
      </div>

      {!me ? (
        <div className="flex items-center gap-2 text-[13px] text-ink-400"><Spinner /> Loading your workspace…</div>
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Plan" value={me.plan.name} hint={`${me.user.creditsRemaining.toLocaleString()} of ${me.plan.credits.toLocaleString()} credits left`} />
            <Stat label="Variants made" value={me.stats.variants} />
            <Stat label="Pairs scored" value={me.stats.scores} />
            <Stat label="Winners saved" value={me.stats.winners} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
            <Section title="Recent scores" subtitle="Every pair you have judged, newest first." actions={<Link className="btn btn-quiet btn-sm" href="/score">New score →</Link>}>
              {scores.length === 0 ? (
                <Empty title="Nothing scored yet">
                  The fastest way in: upload a thumbnail you already made and see where it lands in its shelf.
                </Empty>
              ) : (
                <ul className="divide-y divide-ink-700">
                  {scores.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 py-2.5">
                      <span
                        className="tabular grid h-9 w-9 shrink-0 place-items-center rounded-[8px] text-[13px] font-extrabold"
                        style={{ background: `${scoreColour(s.trc)}1f`, color: scoreColour(s.trc) }}
                      >
                        {Math.round(s.trc)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-semibold">
                          {s.pillars.find((p) => p.key === "title")?.items.find((i) => i.key === "length")?.value ?? "Scored pair"}
                        </p>
                        <p className="mt-0.5 text-[11px] text-ink-400">
                          Grade {s.grade}
                          {s.shelf ? ` · would rank #${s.shelf.rank} of ${s.shelf.outOf}` : " · no shelf loaded"}
                          {` · ${new Date(s.created_at).toLocaleDateString("en-GB")}`}
                        </p>
                      </div>
                      <span className="chip shrink-0">{s.ctrEstimate.low}–{s.ctrEstimate.high}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Deployment status" subtitle={me.mode}>
              <ul className="space-y-2">
                {[
                  { on: true, label: "Scoring engine", note: "Deterministic, pixel-level. Always on." },
                  { on: true, label: "1280×720 rendering", note: "Server-side compositing. Always on." },
                  { on: caps!.claude, label: "Claude", note: "Titles, concepts, visual critique." },
                  { on: caps!.imageGen, label: "Gemini images", note: "Photoreal generation." },
                  { on: caps!.youtubeData, label: "YouTube Data API", note: "Live shelves and stats." },
                  { on: caps!.store === "supabase", label: "Supabase", note: "Shared schema and auth." },
                  { on: caps!.billing, label: "Stripe", note: "Live upgrade checkout." },
                ].map((row) => (
                  <li key={row.label} className="flex items-start gap-2.5">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${row.on ? "bg-good-500" : "bg-ink-600"}`} />
                    <span className="min-w-0">
                      <span className={`block text-[12.5px] font-semibold ${row.on ? "text-ink-100" : "text-ink-400"}`}>{row.label}</span>
                      <span className="block text-[11px] text-ink-400">{row.note}</span>
                    </span>
                  </li>
                ))}
              </ul>

              {missing.length > 0 && (
                <div className="mt-4 hairline pt-3">
                  <p className="text-[11.5px] leading-relaxed text-ink-400">
                    Everything works without these — the module falls back to local art direction, heuristic copy and a
                    modelled shelf. Add them in <code className="text-ink-300">.env.local</code> to switch each one live:
                  </p>
                  <ul className="mt-2 space-y-1">
                    {missing.map((m) => (
                      <li key={m.key} className="text-[11.5px]">
                        <code className="text-accent-400">{m.key}</code>
                        <span className="text-ink-400"> — {m.unlocks}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>
          </div>

          <Section className="mt-5" title="How the score is built" subtitle="Published, not a black box. Every sub-metric ships with its measured value and its target band.">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { w: "35%", t: "Thumbnail craft", d: "Shelf legibility at 168×94, contrast, focal clarity, colour punch, composition, text load, human presence." },
                { w: "25%", t: "Title craft", d: "Hook strength, specificity, mobile truncation, keyword placement, distinctiveness, trust, readability." },
                { w: "15%", t: "Pair coherence", d: "Word redundancy between the two surfaces, promise alignment, combined word load, overlay discipline." },
                { w: "25%", t: "Niche fit", d: "Pattern match against the shelf's conventions, pattern interrupt against its palette, and the quality bar it sets." },
              ].map((p) => (
                <div key={p.t} className="panel-tight p-3.5">
                  <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-accent-500">{p.w} of score</p>
                  <p className="mt-1 text-[13px] font-extrabold">{p.t}</p>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-400">{p.d}</p>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
