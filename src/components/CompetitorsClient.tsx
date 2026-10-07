"use client";

import { useEffect, useState } from "react";
import type { CompetitorShelf, CompetitorVideo } from "@/lib/db/types";
import { api, type MeResponse, type ShelfResponse } from "@/lib/client";
import { Banner, Empty, Field, PageHeader, Section, Spinner, Stat, ThumbPreview } from "@/components/ui";
import { scoreColour } from "@/components/score/ScoreVisuals";

const HUE_LABELS = ["Red", "Orange", "Yellow", "Lime", "Green", "Spring", "Cyan", "Azure", "Blue", "Violet", "Magenta", "Rose"];
const HUE_COLORS = ["#ef4444", "#f97316", "#eab308", "#84cc16", "#22c55e", "#10b981", "#06b6d4", "#0ea5e9", "#3b82f6", "#8b5cf6", "#d946ef", "#f43f5e"];

type SortKey = "rank" | "score" | "views" | "velocity";

export function CompetitorsClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [keyword, setKeyword] = useState("");
  const [shelf, setShelf] = useState<CompetitorShelf | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("rank");

  useEffect(() => {
    api.get<MeResponse>("/api/me").then(setMe).catch(() => undefined);
    api.get<{ shelf: CompetitorShelf }>("/api/shelf")
      .then((d) => { setShelf(d.shelf); setKeyword(d.shelf.keyword); })
      .catch(() => undefined);
  }, []);

  const load = async (refresh = false) => {
    if (!keyword.trim()) { setError("Enter a keyword."); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<ShelfResponse>("/api/shelf", { keyword: keyword.trim(), refresh });
      setShelf(res.shelf);
      setNote(res.note);
      api.get<MeResponse>("/api/me").then(setMe).catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the shelf.");
    } finally {
      setBusy(false);
    }
  };

  const fp = shelf?.fingerprint;
  const sorted: CompetitorVideo[] = shelf
    ? [...shelf.videos].sort((a, b) => {
        if (sort === "score") return (b.score ?? 0) - (a.score ?? 0);
        if (sort === "views") return (b.view_count ?? 0) - (a.view_count ?? 0);
        if (sort === "velocity") return (b.velocity ?? 0) - (a.velocity ?? 0);
        return a.rank - b.rank;
      })
    : [];

  return (
    <div className="mx-auto max-w-[1340px] p-5 sm:p-7">
      <PageHeader
        eyebrow="Competitor shelf"
        title="Read the shelf before you design for it"
        subtitle="Every niche has conventions — how many thumbnails lead with a face, how much text they carry, which colours own the row. Break them by accident and you read as off-topic. Match them exactly and you disappear."
        actions={me && <span className="chip"><span className="tabular font-bold text-ink-100">{me.user.creditsRemaining}</span> credits</span>}
      />

      <Section className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px] flex-1">
            <Field label="Target keyword">
              <input
                className="field"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && load()}
                placeholder="best budget mirrorless camera"
              />
            </Field>
          </div>
          <button className="btn btn-primary" onClick={() => load()} disabled={busy}>
            {busy ? <><Spinner /> Loading</> : "Analyse shelf"}
          </button>
          {shelf && (
            <button className="btn btn-ghost" onClick={() => load(true)} disabled={busy}>Refresh</button>
          )}
        </div>
        {me && !me.capabilities.youtubeData && (
          <p className="mt-3 text-[11.5px] text-ink-400">
            No <code className="text-ink-300">YOUTUBE_API_KEY</code> is configured, so shelves are modelled from the keyword
            rather than fetched live. Everything below still works — the numbers are directional, not real rankings.
          </p>
        )}
      </Section>

      {error && <div className="mb-4"><Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner></div>}
      {note && <div className="mb-4"><Banner tone="warn" onDismiss={() => setNote(null)}>{note}</Banner></div>}

      {!shelf ? (
        <Empty title="No shelf loaded">Enter the keyword you want to rank for and analyse it.</Empty>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Quality bar" value={fp!.medianScore.toFixed(0)} hint="Median TRC of what already ranks. Beat this." />
            <Stat label="Lead with a face" value={`${Math.round(fp!.faceRate * 100)}%`} hint={fp!.faceRate > 0.6 ? "Face-led shelf — a bare graphic will read as off-format." : "Mixed or graphic-led shelf."} />
            <Stat label="Carry overlay text" value={`${Math.round(fp!.textRate * 100)}%`} hint={`Median coverage ${(fp!.medianTextCoverage * 100).toFixed(1)}% of the frame.`} />
            <Stat label="Median title" value={`${fp!.title.medianLength} ch`} hint={`${Math.round(fp!.title.numberRate * 100)}% use a number · ${Math.round(fp!.title.questionRate * 100)}% are questions.`} />
          </div>

          <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_320px]">
            <Section title="Colour ownership" subtitle="Which hues already own this row. Your opening to stand out is where the bars are short.">
              <div className="flex h-[150px] items-end gap-1.5">
                {fp!.hueHistogram.map((v, i) => {
                  const max = Math.max(...fp!.hueHistogram, 0.01);
                  return (
                    <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                      <div
                        className="w-full rounded-t-[3px] transition-all duration-500"
                        style={{ height: `${Math.max(3, (v / max) * 116)}px`, background: HUE_COLORS[i], opacity: 0.55 + (v / max) * 0.45 }}
                        title={`${HUE_LABELS[i]}: ${(v * 100).toFixed(1)}%`}
                      />
                      <span className="w-full truncate text-center text-[9px] text-ink-500">{HUE_LABELS[i]}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-ink-400">Dominant:</span>
                {fp!.dominantColors.slice(0, 6).map((c) => (
                  <span key={c} className="flex items-center gap-1.5 text-[11px] text-ink-300">
                    <span className="h-4 w-4 rounded-[4px] border border-ink-600" style={{ background: c }} />
                    {c}
                  </span>
                ))}
              </div>
            </Section>

            <Section title="Shared language" subtitle="Phrases this shelf overuses. Echo them and your row blends in.">
              {fp!.title.commonBigrams.length === 0 && fp!.title.commonTokens.length === 0 ? (
                <p className="text-[12.5px] text-ink-400">No repeated phrasing — the shelf's wording is already varied.</p>
              ) : (
                <>
                  {fp!.title.commonBigrams.length > 0 && (
                    <div className="mb-3">
                      <p className="label">Repeated phrases</p>
                      <div className="flex flex-wrap gap-1.5">
                        {fp!.title.commonBigrams.map((b) => <span key={b} className="chip">{b}</span>)}
                      </div>
                    </div>
                  )}
                  {fp!.title.commonTokens.length > 0 && (
                    <div>
                      <p className="label">Repeated words</p>
                      <div className="flex flex-wrap gap-1.5">
                        {fp!.title.commonTokens.slice(0, 10).map((t) => <span key={t} className="chip">{t}</span>)}
                      </div>
                    </div>
                  )}
                </>
              )}
            </Section>
          </div>

          <Section
            title={`The shelf · ${shelf.videos.length} videos`}
            subtitle={shelf.source === "modelled" ? "Modelled from the keyword — not live rankings." : `Live from YouTube for "${shelf.keyword}".`}
            actions={
              <select className="field !w-auto !py-1.5 !text-[12px]" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                <option value="rank">Sort: search rank</option>
                <option value="score">Sort: thumbnail score</option>
                <option value="views">Sort: views</option>
                <option value="velocity">Sort: views/day</option>
              </select>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {sorted.map((v) => (
                <article key={v.youtube_id} className="panel-tight overflow-hidden">
                  <div className="relative">
                    <ThumbPreview
                      src={v.thumbnail_url.startsWith("synthetic:") ? null : v.thumbnail_url}
                      alt={v.title}
                      className="!rounded-none"
                    />
                    <span className="absolute left-2 top-2 rounded-[5px] bg-ink-950/85 px-1.5 py-0.5 text-[10px] font-bold">#{v.rank}</span>
                    {typeof v.score === "number" && (
                      <span
                        className="absolute right-2 top-2 rounded-[5px] px-1.5 py-0.5 text-[10px] font-extrabold tabular"
                        style={{ background: `${scoreColour(v.score)}26`, color: scoreColour(v.score), backdropFilter: "blur(6px)" }}
                      >
                        {Math.round(v.score)}
                      </span>
                    )}
                  </div>
                  <div className="p-2.5">
                    <p className="line-clamp-2 text-[12.5px] font-semibold leading-snug">{v.title}</p>
                    <p className="mt-1 truncate text-[11px] text-ink-400">{v.channel_title}</p>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-ink-500 tabular">
                      {v.view_count !== null && <span>{Intl.NumberFormat("en", { notation: "compact" }).format(v.view_count)} views</span>}
                      {v.velocity !== null && <span>{Intl.NumberFormat("en", { notation: "compact" }).format(v.velocity)}/day</span>}
                      {v.subscriber_count !== null && <span>{Intl.NumberFormat("en", { notation: "compact" }).format(v.subscriber_count)} subs</span>}
                    </div>
                    {v.analysis && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {v.analysis.faceRegion && <span className="chip !py-0 !text-[9.5px]">face</span>}
                        {v.analysis.textCoverage > 0.04 && <span className="chip !py-0 !text-[9.5px]">text</span>}
                        <span className="chip !py-0 !text-[9.5px]">{Math.round(v.analysis.saturation * 100)}% sat</span>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
