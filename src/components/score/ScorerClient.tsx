"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CompetitorShelf, PairScore } from "@/lib/db/types";
import {
  api, type MeResponse, type ScoreResponse, type ShelfResponse, type VariantDTO,
} from "@/lib/client";
import { Banner, Empty, Field, PageHeader, Section, Spinner, Stat, ThumbPreview } from "@/components/ui";
import { AxesPlot, CtrBand, FixList, PillarCard, ScoreDial, ShelfSimulation } from "./ScoreVisuals";

/**
 * The standalone scorer.
 *
 * This is the fastest path to value in the whole product: drop in the thumbnail
 * you already made, paste the title you were going to publish, and find out
 * where it would land in the shelf — before you publish, not after.
 */
export function ScorerClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [variants, setVariants] = useState<VariantDTO[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [keyword, setKeyword] = useState("");
  const [shelf, setShelf] = useState<CompetitorShelf | null>(null);
  const [shelfNote, setShelfNote] = useState<string | null>(null);
  const [score, setScore] = useState<PairScore | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dropRef = useRef<HTMLLabelElement | null>(null);

  const active = variants.find((v) => v.id === activeId) ?? null;

  useEffect(() => {
    api.get<MeResponse>("/api/me").then(setMe).catch(() => undefined);
    api.get<{ variants: VariantDTO[] }>("/api/variants?limit=24")
      .then((d) => {
        setVariants(d.variants);
        setActiveId((id) => id ?? d.variants[0]?.id ?? null);
      })
      .catch(() => undefined);
  }, []);

  const upload = async (file: File) => {
    setBusy("Analysing the image");
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("label", file.name.replace(/\.[^.]+$/, ""));
      const res = await api.upload<{ variant: VariantDTO }>("/api/variants/upload", form);
      setVariants((v) => [res.variant, ...v]);
      setActiveId(res.variant.id);
      setScore(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that image.");
    } finally {
      setBusy(null);
    }
  };

  const loadShelf = useCallback(async () => {
    if (!keyword.trim()) return null;
    setBusy("Loading the shelf");
    try {
      const res = await api.post<ShelfResponse>("/api/shelf", { keyword: keyword.trim() });
      setShelf(res.shelf);
      setShelfNote(res.note);
      return res.shelf;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the shelf.");
      return null;
    } finally {
      setBusy(null);
    }
  }, [keyword]);

  const runScore = async (withAi: boolean) => {
    if (!active) { setError("Select or upload a thumbnail first."); return; }
    if (!title.trim()) { setError("Enter the title you plan to publish."); return; }
    let current = shelf;
    if (keyword.trim() && (!shelf || shelf.keyword !== keyword.trim())) {
      current = await loadShelf();
    }
    setBusy(withAi ? "Scoring with Claude" : "Scoring");
    setError(null);
    try {
      const res = await api.post<ScoreResponse>("/api/score", {
        title: title.trim(),
        variantId: active.id,
        keyword: keyword.trim() || undefined,
        shelfId: current?.id,
        withAi,
      });
      setScore(res.score);
      setSaved(false);
      api.get<MeResponse>("/api/me").then(setMe).catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scoring failed.");
    } finally {
      setBusy(null);
    }
  };

  const saveWinner = async () => {
    if (!active || !score) return;
    try {
      await api.post("/api/winners", {
        variantId: active.id,
        titleText: title.trim(),
        scoreId: score.id,
        keyword: keyword.trim() || undefined,
        trc: score.trc,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    }
  };

  return (
    <div className="mx-auto max-w-[1340px] p-5 sm:p-7">
      <PageHeader
        eyebrow="Scorer"
        title="Will this pair win its shelf?"
        subtitle="Upload the thumbnail you already made, paste the title you were about to publish, and see exactly where it would land among the videos already ranking for your keyword."
        actions={me && <span className="chip"><span className="tabular font-bold text-ink-100">{me.user.creditsRemaining}</span> credits</span>}
      />

      {error && <div className="mb-4"><Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner></div>}
      {shelfNote && <div className="mb-4"><Banner tone="warn" onDismiss={() => setShelfNote(null)}>{shelfNote}</Banner></div>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Section title="1 · Thumbnail">
            <label
              ref={dropRef}
              className="block cursor-pointer rounded-[11px] border-2 border-dashed border-ink-600 p-5 text-center transition-colors hover:border-accent-500 hover:bg-accent-500/5"
              onDragOver={(e) => { e.preventDefault(); dropRef.current?.classList.add("border-accent-500"); }}
              onDragLeave={() => dropRef.current?.classList.remove("border-accent-500")}
              onDrop={(e) => {
                e.preventDefault();
                dropRef.current?.classList.remove("border-accent-500");
                const f = e.dataTransfer.files?.[0];
                if (f) upload(f);
              }}
            >
              <input
                type="file" accept="image/png,image/jpeg,image/webp,image/avif" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }}
              />
              <p className="text-[13px] font-bold">Drop a thumbnail, or click to browse</p>
              <p className="mt-1 text-[11.5px] text-ink-400">PNG, JPEG, WebP or AVIF — resized to 1280×720 for analysis.</p>
            </label>

            {variants.length > 0 && (
              <>
                <p className="label mt-4">Or pick one you already made</p>
                <div className="grid grid-cols-3 gap-2 max-h-[246px] overflow-y-auto pr-1">
                  {variants.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => { setActiveId(v.id); setScore(null); }}
                      className={`rounded-[8px] p-1 transition-all ${v.id === activeId ? "bg-accent-500/15 ring-2 ring-accent-500" : "bg-ink-850 hover:bg-ink-800"}`}
                    >
                      <ThumbPreview src={v.renderAssetUrl} alt={v.label} className="!rounded-[5px]" />
                      <span className="mt-1 block truncate px-0.5 text-[10.5px] text-ink-400">{v.label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </Section>

          <Section title="2 · Title & keyword">
            <Field label="Title">
              <textarea
                className="field min-h-[72px] resize-y"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="The title you plan to publish"
              />
            </Field>
            <p className="mt-1.5 mb-3 text-[11.5px] tabular text-ink-400">
              {title.length} characters{title.length > 48 ? " · mobile cuts after 48" : ""}
            </p>
            <Field label="Target keyword" hint="Loads the live shelf. Without it you get craft scores only, no shelf rank.">
              <input className="field" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="best travel camera 2026" />
            </Field>

            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn btn-primary" onClick={() => runScore(false)} disabled={Boolean(busy)}>
                {busy ? <><Spinner /> {busy}</> : "Score the pair"}
              </button>
              {me?.capabilities.claude && (
                <button className="btn btn-accent" onClick={() => runScore(true)} disabled={Boolean(busy)}>
                  + AI critique
                </button>
              )}
            </div>
          </Section>

          {active && (
            <Section title="At shelf size" subtitle="The only size that matters.">
              <div className="flex items-start gap-4">
                <ThumbPreview src={active.renderAssetUrl} alt={active.label} title={title || "Your title here"} channel="Your channel" shelfSize />
                <div className="min-w-0 flex-1">
                  <ThumbPreview src={active.renderAssetUrl} alt={active.label} />
                </div>
              </div>
            </Section>
          )}
        </div>

        <div className="space-y-4">
          {!score ? (
            <Section>
              <Empty title="No score yet">
                Add a thumbnail and a title, then score. With a keyword set you also get a simulated shelf
                position against the videos currently ranking.
              </Empty>
            </Section>
          ) : (
            <>
              <Section>
                <div className="flex flex-wrap items-center gap-5">
                  <ScoreDial score={score.trc} grade={score.grade} />
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Stat
                        label="Shelf position"
                        value={score.shelf ? `#${score.shelf.rank} of ${score.shelf.outOf}` : "—"}
                        hint={score.shelf ? `Beats ${score.shelf.beats} ranking videos.` : "Add a keyword for shelf rank."}
                        tone={score.shelf ? (score.shelf.rank <= 3 ? "good" : score.shelf.rank <= 6 ? "warn" : "bad") : "default"}
                      />
                      <Stat
                        label="vs shelf median"
                        value={score.shelf ? `${score.trc > score.shelf.medianScore ? "+" : ""}${(score.trc - score.shelf.medianScore).toFixed(1)}` : "—"}
                        hint="Points above the median of what already ranks."
                        tone={score.shelf ? (score.trc >= score.shelf.medianScore ? "good" : "bad") : "default"}
                      />
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={saveWinner} disabled={saved}>
                      {saved ? "Saved to winners" : "Save as winner"}
                    </button>
                  </div>
                </div>
              </Section>

              <div className="grid gap-4 md:grid-cols-2">
                <Section title="Modelled CTR"><CtrBand estimate={score.ctrEstimate} /></Section>
                <Section title="Fit vs stand-out"><AxesPlot axes={score.axes} /></Section>
              </div>

              {score.critique && (
                <Section title="Claude's visual read" subtitle="Layered on top of the measured signals, not replacing them.">
                  <p className="text-[13px] leading-relaxed text-ink-200">{score.critique.verdict}</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {score.critique.strengths.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-good-400 mb-1">Working</p>
                        <ul className="list-disc pl-4 space-y-0.5 text-[12px] text-ink-300">
                          {score.critique.strengths.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                    {score.critique.risks.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-warn-400 mb-1">Risks</p>
                        <ul className="list-disc pl-4 space-y-0.5 text-[12px] text-ink-300">
                          {score.critique.risks.map((r, i) => <li key={i}>{r}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                  <p className="mt-3 rounded-[9px] bg-accent-500/10 px-3 py-2.5 text-[12.5px] leading-relaxed">
                    <span className="font-bold text-accent-400">Do this first: </span>
                    <span className="text-ink-200">{score.critique.oneChange}</span>
                  </p>
                </Section>
              )}

              {shelf && score.shelf && (
                <Section title="Shelf simulation" subtitle="Scored by the identical engine, at the size YouTube renders.">
                  <ShelfSimulation score={score} title={title} thumbUrl={active?.renderAssetUrl ?? null} competitors={shelf.videos} />
                </Section>
              )}

              <Section title="Ranked fixes" subtitle="Ordered by the TRC points each one is worth.">
                <FixList fixes={score.fixes} />
              </Section>

              <Section title="Full breakdown" subtitle="Every measured signal, its target band, and why it matters.">
                <div className="space-y-2">
                  {score.pillars.map((p, i) => <PillarCard key={p.key} pillar={p} defaultOpen={i === 0} />)}
                </div>
                <p className="mt-3 text-[11px] text-ink-500">Engine {score.engine_version}</p>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
