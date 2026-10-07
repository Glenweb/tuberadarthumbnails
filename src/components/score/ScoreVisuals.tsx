"use client";

import { useState } from "react";
import type { CompetitorVideo, FixSuggestion, PairScore, ScorePillar } from "@/lib/db/types";
import { ThumbPreview } from "@/components/ui";

const GRADE_TONE: Record<PairScore["grade"], { ring: string; text: string; label: string }> = {
  S: { ring: "#22c55e", text: "text-good-400", label: "Shelf leader" },
  A: { ring: "#4ade80", text: "text-good-400", label: "Strong" },
  B: { ring: "#fbbf24", text: "text-warn-400", label: "Competitive" },
  C: { ring: "#f59e0b", text: "text-warn-400", label: "Needs work" },
  D: { ring: "#ef4444", text: "text-bad-400", label: "Will be skipped" },
};

export function scoreColour(score: number): string {
  if (score >= 78) return "#22c55e";
  if (score >= 58) return "#84cc16";
  if (score >= 44) return "#f59e0b";
  return "#ef4444";
}

/** The headline gauge: TubeRadar Click Index, 0–100. */
export function ScoreDial({ score, grade, size = 164 }: { score: number; grade: PairScore["grade"]; size?: number }) {
  const r = size / 2 - 11;
  const circ = 2 * Math.PI * r;
  const tone = GRADE_TONE[grade];
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1d2335" strokeWidth="11" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={tone.ring} strokeWidth="11" strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - Math.max(0, Math.min(100, score)) / 100)}
          style={{ transition: "stroke-dashoffset .7s cubic-bezier(.2,.8,.2,1)" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-[38px] font-extrabold leading-none tabular">{Math.round(score)}</p>
          <p className={`mt-0.5 text-[11px] font-bold uppercase tracking-[0.1em] ${tone.text}`}>
            {grade} · {tone.label}
          </p>
        </div>
      </div>
      <span className="sr-only">TubeRadar Click Index {Math.round(score)} out of 100, grade {grade}.</span>
    </div>
  );
}

/** Expandable pillar with every sub-metric, its measured value and its target. */
export function PillarCard({ pillar, defaultOpen = false }: { pillar: ScorePillar; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="panel-tight overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-ink-800 transition-colors"
        aria-expanded={open}
      >
        <span className="tabular text-[17px] font-extrabold w-[34px]" style={{ color: scoreColour(pillar.score) }}>
          {pillar.score}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold">{pillar.label}</span>
          <span className="block h-1 mt-1.5 rounded-full bg-ink-700 overflow-hidden">
            <span
              className="block h-full rounded-full transition-all duration-700"
              style={{ width: `${pillar.score}%`, background: scoreColour(pillar.score) }}
            />
          </span>
        </span>
        <span className="chip shrink-0">{Math.round(pillar.weight * 100)}% of score</span>
        <span className={`text-ink-400 text-[11px] transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
      </button>

      {open && (
        <div className="hairline divide-y divide-ink-700">
          {pillar.items.map((item) => (
            <div key={item.key} className="px-3.5 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[12.5px] font-semibold">{item.label}</p>
                <p className="tabular text-[12.5px] font-bold shrink-0" style={{ color: scoreColour(item.score) }}>
                  {item.score}
                </p>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px] text-ink-400">
                <span>Measured: <span className="text-ink-200">{item.value}</span></span>
                <span>Target: <span className="text-ink-200">{item.target}</span></span>
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-ink-300">{item.note}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Shelf simulation: the candidate dropped into the result set, ranked by the
 * same engine that scored it. This is the view that turns an abstract score
 * into a decision.
 */
export function ShelfSimulation({
  score, title, thumbUrl, competitors,
}: {
  score: PairScore;
  title: string;
  thumbUrl: string | null;
  competitors: CompetitorVideo[];
}) {
  if (!score.shelf) return null;
  const rows = [
    ...competitors
      .filter((c) => typeof c.score === "number")
      .map((c) => ({ kind: "rival" as const, score: c.score as number, video: c })),
    { kind: "you" as const, score: score.trc, video: null },
  ].sort((a, b) => b.score - a.score);

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
        <p className="text-[13px] font-bold">
          You would rank{" "}
          <span className="text-accent-400">#{score.shelf.rank} of {score.shelf.outOf}</span>
        </p>
        <p className="text-[12px] text-ink-400">
          Beating {score.shelf.beats} of {score.shelf.outOf - 1} ranking videos · shelf median {score.shelf.medianScore} · top {score.shelf.topScore}
        </p>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
        {rows.map((row, i) => (
          <div
            key={row.kind === "you" ? "you" : row.video!.youtube_id}
            className={`relative rounded-[9px] p-1.5 shrink-0 ${
              row.kind === "you" ? "bg-accent-500/12 ring-2 ring-accent-500" : "bg-ink-850"
            }`}
          >
            <div className="flex items-center justify-between gap-2 px-0.5 pb-1.5">
              <span className="text-[10px] font-bold text-ink-400">#{i + 1}</span>
              <span className="tabular text-[11px] font-extrabold" style={{ color: scoreColour(row.score) }}>
                {Math.round(row.score)}
              </span>
            </div>
            {row.kind === "you" ? (
              <ThumbPreview src={thumbUrl} alt="Your thumbnail" title={title} channel="You" shelfSize />
            ) : (
              <ThumbPreview
                src={row.video!.thumbnail_url.startsWith("synthetic:") ? null : row.video!.thumbnail_url}
                alt={row.video!.title}
                title={row.video!.title}
                channel={row.video!.channel_title}
                shelfSize
              />
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-ink-400">
        Every cell above is scored by the identical engine, at the size YouTube actually renders it.
      </p>
    </div>
  );
}

/** Pattern match vs pattern interrupt, plotted. The sweet spot is top-right. */
export function AxesPlot({ axes }: { axes: { conventionFit: number; differentiation: number } }) {
  const x = Math.max(0, Math.min(100, axes.differentiation));
  const y = Math.max(0, Math.min(100, axes.conventionFit));
  const verdict =
    y >= 65 && x >= 65 ? { text: "Fits the shelf and stands out — the winning quadrant.", tone: "text-good-400" }
    : y >= 65 ? { text: "Fits in, but blends in. Push colour and wording away from the pack.", tone: "text-warn-400" }
    : x >= 65 ? { text: "Stands out, but reads as off-format. Match the shelf's structure.", tone: "text-warn-400" }
    : { text: "Neither matching nor interrupting. Fix convention fit first.", tone: "text-bad-400" };

  return (
    <div>
      <div className="relative aspect-square w-full max-w-[230px] rounded-[11px] border border-ink-700 bg-ink-950">
        <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
          <div className="border-r border-b border-ink-800" />
          <div className="border-b border-ink-800 bg-good-500/7" />
          <div className="border-r border-ink-800" />
          <div className="border-ink-800" />
        </div>
        <span className="absolute left-1.5 top-1.5 text-[9px] font-bold uppercase tracking-wide text-ink-500">Invisible</span>
        <span className="absolute right-1.5 top-1.5 text-[9px] font-bold uppercase tracking-wide text-good-500">Wins</span>
        <span className="absolute left-1.5 bottom-1.5 text-[9px] font-bold uppercase tracking-wide text-ink-500">Skipped</span>
        <span className="absolute right-1.5 bottom-1.5 text-[9px] font-bold uppercase tracking-wide text-ink-500">Off-format</span>
        <div
          className="absolute h-3.5 w-3.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-accent-500 ring-4 ring-accent-500/25"
          style={{ left: `${x}%`, bottom: `${y}%` }}
          title={`Differentiation ${x}, convention fit ${y}`}
        />
      </div>
      <div className="mt-2.5 space-y-0.5 text-[11.5px]">
        <p className="text-ink-300">Convention fit <span className="tabular font-bold text-ink-100">{y}</span> · Differentiation <span className="tabular font-bold text-ink-100">{x}</span></p>
        <p className={verdict.tone}>{verdict.text}</p>
      </div>
    </div>
  );
}

/** Modelled CTR band — labelled as an estimate, with its basis stated. */
export function CtrBand({ estimate }: { estimate: PairScore["ctrEstimate"] }) {
  const tone = { high: "text-good-400", medium: "text-warn-400", low: "text-ink-400" }[estimate.confidence];
  return (
    <div className="panel-tight p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-400">Modelled CTR</p>
        <span className={`text-[10px] font-bold uppercase tracking-wide ${tone}`}>{estimate.confidence} confidence</span>
      </div>
      <p className="mt-1 text-[21px] font-extrabold leading-none tabular">
        {estimate.low}%<span className="text-ink-400 font-bold"> – </span>{estimate.high}%
      </p>
      {estimate.nicheMedian !== null && (
        <p className="mt-1 text-[11.5px] text-ink-400">Shelf-median video sits near {estimate.nicheMedian}%.</p>
      )}
      <p className="mt-1.5 text-[11px] leading-snug text-ink-400">{estimate.basis}</p>
      <p className="mt-1.5 text-[10.5px] leading-snug text-ink-500">
        An estimate derived from the score, not a measurement or a promise. Record your real CTR on a saved winner to calibrate it.
      </p>
    </div>
  );
}

/** Ranked fixes, each with the TRC points it is worth. */
export function FixList({
  fixes, onApply,
}: { fixes: FixSuggestion[]; onApply?: (fix: FixSuggestion) => void }) {
  if (fixes.length === 0) {
    return (
      <p className="text-[12.5px] text-good-400">
        Nothing material left to fix — every measured signal is inside its target band for this shelf.
      </p>
    );
  }
  return (
    <ol className="space-y-2">
      {fixes.map((fix) => (
        <li key={fix.id} className="panel-tight p-3.5">
          <div className="flex items-start gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] bg-ink-700 text-[11px] font-extrabold tabular">
              {fix.priority}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-[13px] font-bold">{fix.title}</p>
                <span className="chip border-good-500/30 bg-good-500/10 text-good-400 shrink-0">
                  +{fix.estimatedGain.toFixed(1)} pts
                </span>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-300">{fix.detail}</p>
              {fix.autoFixable && onApply && (
                <button className="btn btn-ghost btn-sm mt-2" onClick={() => onApply(fix)}>
                  Apply this fix
                </button>
              )}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
