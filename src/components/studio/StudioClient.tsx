"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CompetitorShelf, PairScore, SourceVideo, TextOverlay, ThumbnailConcept,
} from "@/lib/db/types";
import {
  api, ApiError,
  type GenerateResponse, type MeResponse, type ResolveResponse,
  type ScoreResponse, type ShelfResponse, type TitlesResponse, type VariantDTO,
} from "@/lib/client";
import { Banner, Empty, Field, PageHeader, Section, Spinner, Stat, ThumbPreview } from "@/components/ui";
import { OverlayEditor } from "./OverlayEditor";
import { ScoreDial, FixList, ShelfSimulation, CtrBand, AxesPlot, PillarCard, scoreColour } from "@/components/score/ScoreVisuals";
import { TitleLab } from "./TitleLab";

type Step = "input" | "concepts" | "variants";

export function StudioClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [step, setStep] = useState<Step>("input");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

  // Inputs
  const [url, setUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [keyword, setKeyword] = useState("");
  const [count, setCount] = useState(4);
  const [style, setStyle] = useState<"impact" | "plate" | "kicker" | "outline" | "editorial">("impact");
  const [direction, setDirection] = useState("");

  // Pipeline state
  const [source, setSource] = useState<(SourceVideo & { thumbnailAssetUrl: string | null }) | null>(null);
  const [shelf, setShelf] = useState<CompetitorShelf | null>(null);
  const [shelfNote, setShelfNote] = useState<string | null>(null);
  const [concepts, setConcepts] = useState<ThumbnailConcept[] | null>(null);
  const [variants, setVariants] = useState<VariantDTO[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [score, setScore] = useState<PairScore | null>(null);
  const [scoring, setScoring] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const active = variants.find((v) => v.id === activeId) ?? null;

  useEffect(() => {
    api.get<MeResponse>("/api/me").then(setMe).catch(() => undefined);
  }, []);

  const refreshMe = useCallback(() => {
    api.get<MeResponse>("/api/me").then(setMe).catch(() => undefined);
  }, []);

  const run = useCallback(
    async <T,>(stage: string, fn: () => Promise<T>): Promise<T | null> => {
      setBusy(stage);
      setError(null);
      try {
        return await fn();
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.code === "insufficient_credits"
              ? `${err.message} (Plan page → upgrade, or wait for the monthly reset.)`
              : err.message
            : err instanceof Error
              ? err.message
              : "Something went wrong.",
        );
        return null;
      } finally {
        setBusy(null);
        refreshMe();
      }
    },
    [refreshMe],
  );

  /* ───────────────────────── Step 1: resolve + shelf ──────────────────── */

  const start = async () => {
    if (!url.trim() && !prompt.trim()) {
      setError("Paste a YouTube URL or describe the video.");
      return;
    }
    const resolved = await run("Reading the video", () =>
      api.post<ResolveResponse>("/api/source/resolve", {
        url: url.trim() || undefined,
        prompt: prompt.trim() || undefined,
        keyword: keyword.trim() || undefined,
      }),
    );
    if (!resolved) return;

    setSource(resolved.source);
    setNotes(resolved.warnings);
    if (!title) setTitle(resolved.source.title ?? prompt.trim());
    const kw = keyword.trim() || resolved.source.keyword;
    if (kw && !keyword.trim()) setKeyword(kw);

    if (kw) {
      const shelfRes = await run("Loading the competitor shelf", () =>
        api.post<ShelfResponse>("/api/shelf", { keyword: kw }),
      );
      if (shelfRes) {
        setShelf(shelfRes.shelf);
        setShelfNote(shelfRes.note);
      }
    }

    const conceptRes = await run("Designing concepts", () =>
      api.post<{ concepts: ThumbnailConcept[]; source: string; note?: string }>("/api/concepts", {
        sourceVideoId: resolved.source.id,
        count,
        notes: direction.trim() || undefined,
      }),
    );
    if (conceptRes) {
      setConcepts(conceptRes.concepts);
      if (conceptRes.note) setNotes((n) => [...n, conceptRes.note!]);
      setStep("concepts");
    }
  };

  /* ───────────────────────── Step 2: render variants ──────────────────── */

  const generate = async (useConcepts: ThumbnailConcept[] | null) => {
    if (!source) return;
    const res = await run(`Rendering ${count} variants`, () =>
      api.post<GenerateResponse>("/api/variants/generate", {
        sourceVideoId: source.id,
        shelfId: shelf?.id,
        count,
        style,
        notes: direction.trim() || undefined,
        concepts: useConcepts ?? undefined,
      }),
    );
    if (!res) return;
    setVariants(res.variants);
    setActiveId(res.variants[0]?.id ?? null);
    setNotes(res.notes);
    setStep("variants");
  };

  /* ───────────────────────── Scoring ──────────────────────────────────── */

  const scoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doScore = useCallback(
    async (opts: { withAi?: boolean; preview?: boolean; overlays?: TextOverlay[] } = {}) => {
      if (!active || !title.trim()) return;
      setScoring(true);
      try {
        const res = await api.post<ScoreResponse>("/api/score", {
          title: title.trim(),
          variantId: active.id,
          sourceVideoId: source?.id,
          keyword: keyword.trim() || undefined,
          shelfId: shelf?.id,
          withAi: opts.withAi ?? false,
          preview: opts.preview ?? false,
        });
        setScore(res.score);
        if (res.aiNote) setNotes((n) => (n.includes(res.aiNote!) ? n : [...n, res.aiNote!]));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Scoring failed.");
      } finally {
        setScoring(false);
        refreshMe();
      }
    },
    [active, title, source?.id, keyword, shelf?.id, refreshMe],
  );

  // Live preview scoring as the user edits — debounced and free.
  useEffect(() => {
    if (!active || !title.trim()) return;
    if (scoreTimer.current) clearTimeout(scoreTimer.current);
    scoreTimer.current = setTimeout(() => doScore({ preview: true }), 500);
    return () => {
      if (scoreTimer.current) clearTimeout(scoreTimer.current);
    };
  }, [active, title, doScore]);

  const saveWinner = async () => {
    if (!active || !score) return;
    const res = await run("Saving", () =>
      api.post<{ winner: { id: string } }>("/api/winners", {
        variantId: active.id,
        titleText: title.trim(),
        scoreId: score.id,
        sourceVideoId: source?.id,
        keyword: keyword.trim() || undefined,
        trc: score.trc,
      }),
    );
    if (res) setSaved(active.id);
  };

  const uploadOwn = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    if (source?.id) form.append("sourceVideoId", source.id);
    form.append("label", file.name.replace(/\.[^.]+$/, ""));
    const res = await run("Analysing your upload", () =>
      api.upload<{ variant: VariantDTO }>("/api/variants/upload", form),
    );
    if (!res) return;
    setVariants((v) => [res.variant, ...v]);
    setActiveId(res.variant.id);
    setStep("variants");
  };

  const limits = me?.plan.limits;

  return (
    <div className="mx-auto max-w-[1340px] p-5 sm:p-7">
      <PageHeader
        eyebrow="Studio"
        title="Build a thumbnail that wins its shelf"
        subtitle="Paste a YouTube URL or describe the video. We read the competitor shelf first, then design against it — so every variant is built to beat the videos it will actually sit beside."
        actions={
          me && (
            <span className="chip">
              <span className="tabular font-bold text-ink-100">{me.user.creditsRemaining}</span> credits
            </span>
          )
        }
      />

      {error && <div className="mb-4"><Banner tone="error" title="That didn't work" onDismiss={() => setError(null)}>{error}</Banner></div>}
      {notes.length > 0 && (
        <div className="mb-4">
          <Banner tone="warn" title="Worth knowing" onDismiss={() => setNotes([])}>
            <ul className="list-disc pl-4 space-y-0.5">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          </Banner>
        </div>
      )}

      {/* ─────────────────── Step 1: input ─────────────────── */}
      <Section
        title="1 · Source"
        subtitle="A URL gives us the current thumbnail to beat and a baseline score. A prompt works too."
        className="mb-4"
      >
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_200px]">
          <Field label="YouTube URL" hint="Watch, Shorts, youtu.be or a bare video id.">
            <input className="field" placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <Field label="…or describe the video" hint="Used when there is no URL yet — planning before you film.">
            <input className="field" placeholder="How I cut my AWS bill by 70%" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </Field>
          <Field label="Target keyword" hint="The search term you want to rank for.">
            <input className="field" placeholder="aws cost optimisation" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          </Field>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Variants" hint={limits ? `${me?.plan.name} allows ${limits.variantsPerRun} per run.` : undefined}>
            <input
              type="number" min={1} max={limits?.variantsPerRun ?? 4} className="field"
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(limits?.variantsPerRun ?? 4, Number(e.target.value) || 1)))}
            />
          </Field>
          <Field label="Overlay style">
            <select className="field" value={style} onChange={(e) => setStyle(e.target.value as typeof style)}>
              <option value="impact">Impact — heavy white + stroke</option>
              <option value="plate">Colour plate</option>
              <option value="kicker">Kicker + headline</option>
              <option value="outline">Outline accent</option>
              <option value="editorial">Editorial</option>
            </select>
          </Field>
          <Field label="Art direction notes" hint="Optional. Steers the concepting pass.">
            <input className="field" placeholder="no stock-photo faces, keep it dark" value={direction} onChange={(e) => setDirection(e.target.value)} />
          </Field>
          <div className="flex items-end gap-2">
            <button className="btn btn-primary flex-1" onClick={start} disabled={Boolean(busy)}>
              {busy ? <><Spinner /> {busy}</> : "Analyse & design"}
            </button>
          </div>
        </div>

        <div className="mt-4 hairline pt-4 flex flex-wrap items-center gap-3">
          <label className="btn btn-ghost btn-sm cursor-pointer">
            Upload an existing thumbnail
            <input
              type="file" accept="image/png,image/jpeg,image/webp,image/avif" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadOwn(f); e.target.value = ""; }}
            />
          </label>
          <p className="text-[11.5px] text-ink-400">
            Already have a thumbnail? Upload it to score and edit it — no API keys needed for that path.
          </p>
        </div>
      </Section>

      {/* ─────────────────── Source + shelf summary ─────────────────── */}
      {source && (
        <div className="mb-4 grid gap-4 lg:grid-cols-[320px_1fr]">
          <Section title="Your source">
            <ThumbPreview src={source.thumbnailAssetUrl} alt="Current thumbnail" />
            <p className="mt-2.5 text-[13px] font-semibold leading-snug">{source.title ?? "Untitled"}</p>
            <p className="mt-0.5 text-[11.5px] text-ink-400">
              {source.channel_title ?? "No channel data"}
              {source.view_count ? ` · ${source.view_count.toLocaleString()} views` : ""}
            </p>
            {source.baseline_analysis && (
              <p className="mt-2 text-[11.5px] text-ink-400">
                Baseline measured — every variant below is compared against it.
              </p>
            )}
          </Section>

          <Section
            title="The shelf you're competing in"
            subtitle={shelf ? `Top ${shelf.videos.length} for "${shelf.keyword}"` : "Add a keyword to load the shelf."}
            actions={shelf && <a className="btn btn-quiet btn-sm" href="/competitors">Open grid →</a>}
          >
            {shelfNote && <div className="mb-3"><Banner tone="warn">{shelfNote}</Banner></div>}
            {shelf ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Shelf median score" value={shelf.fingerprint.medianScore.toFixed(0)} hint="The bar you have to clear." />
                <Stat label="Lead with a face" value={`${Math.round(shelf.fingerprint.faceRate * 100)}%`} hint="Match this or you read as off-format." />
                <Stat label="Carry overlay text" value={`${Math.round(shelf.fingerprint.textRate * 100)}%`} />
                <Stat label="Median title" value={`${shelf.fingerprint.title.medianLength} ch`} hint={`${shelf.fingerprint.title.medianWordCount} words typical.`} />
              </div>
            ) : (
              <Empty title="No shelf loaded">Set a target keyword above and run the analysis.</Empty>
            )}
          </Section>
        </div>
      )}

      {/* ─────────────────── Step 2: concepts ─────────────────── */}
      {step === "concepts" && concepts && (
        <Section
          title="2 · Concepts"
          subtitle="Each one attacks a different gap in the shelf. Edit nothing, or tweak the overlay copy before rendering."
          className="mb-4"
          actions={
            <button className="btn btn-primary" onClick={() => generate(concepts)} disabled={Boolean(busy)}>
              {busy ? <><Spinner /> {busy}</> : `Render ${count} variants`}
            </button>
          }
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {concepts.map((c, i) => (
              <article key={c.id} className="panel-tight p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[13px] font-extrabold">{c.name}</h3>
                  <span className="chip shrink-0">#{i + 1}</span>
                </div>
                <p className="mt-1 text-[12px] text-ink-300 leading-relaxed">{c.angle}</p>
                <div className="mt-2.5 flex gap-1">
                  {c.palette.slice(0, 5).map((p) => (
                    <span key={p} className="h-5 w-5 rounded-[4px] border border-ink-600" style={{ background: p }} title={p} />
                  ))}
                </div>
                <label className="label mt-3">Overlay copy</label>
                <input
                  className="field"
                  value={c.overlayText}
                  onChange={(e) =>
                    setConcepts((prev) => prev?.map((x) => (x.id === c.id ? { ...x, overlayText: e.target.value } : x)) ?? prev)
                  }
                />
                <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-400">
                  <span className="font-bold text-accent-500">Gap it exploits: </span>{c.differentiator}
                </p>
              </article>
            ))}
          </div>
        </Section>
      )}

      {/* ─────────────────── Step 3: variants + editor + score ─────────────────── */}
      {variants.length > 0 && (
        <>
          <Section
            title="3 · Variants"
            subtitle="Click a variant to edit it. The score on the right updates as you type."
            className="mb-4"
            actions={
              concepts && (
                <button className="btn btn-ghost btn-sm" onClick={() => generate(concepts)} disabled={Boolean(busy)}>
                  {busy ? <><Spinner /> {busy}</> : "Regenerate"}
                </button>
              )
            }
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {variants.map((v) => (
                <button
                  key={v.id}
                  onClick={() => { setActiveId(v.id); setScore(null); }}
                  className={`text-left rounded-[11px] p-1.5 transition-all ${
                    v.id === activeId ? "bg-accent-500/12 ring-2 ring-accent-500" : "bg-ink-850 hover:bg-ink-800"
                  }`}
                >
                  <ThumbPreview src={v.renderAssetUrl} alt={v.label} className="!rounded-[8px]" />
                  <div className="flex items-center justify-between gap-2 px-1 pt-2">
                    <span className="truncate text-[12px] font-bold">{v.label}</span>
                    {saved === v.id && <span className="chip border-good-500/30 text-good-400 shrink-0">Saved</span>}
                  </div>
                  <span className="block px-1 pb-1 text-[11px] text-ink-400">
                    {v.origin === "uploaded" ? "Your upload" : v.origin === "generated" ? "AI generated" : "Local art direction"}
                  </span>
                </button>
              ))}
            </div>
          </Section>

          {active && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <Section title="4 · Edit" subtitle="Drag the text to reposition. The shelf-size preview shows what viewers actually see.">
                <OverlayEditor
                  key={active.id}
                  variant={active}
                  onSaved={(v) => {
                    setVariants((prev) => prev.map((x) => (x.id === v.id ? v : x)));
                    doScore({ preview: true });
                  }}
                  onPreviewChange={() => setScore((s) => s)}
                />
              </Section>

              <div className="space-y-4">
                <Section
                  title="5 · Title + score"
                  subtitle="The pair is judged together — the thumbnail and title are one unit."
                >
                  <Field label="Title">
                    <textarea
                      className="field min-h-[66px] resize-y"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Write or paste the title you plan to publish"
                    />
                  </Field>
                  <p className="mt-1.5 text-[11.5px] text-ink-400 tabular">
                    {title.length} characters · mobile shows the first 48
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className="btn btn-accent btn-sm" onClick={() => doScore({ withAi: true })} disabled={scoring || !title.trim()}>
                      {scoring ? <><Spinner /> Scoring</> : "Full score + AI critique"}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={saveWinner} disabled={!score || !title.trim()}>
                      Save as winner
                    </button>
                  </div>

                  {score && (
                    <div className="mt-4 space-y-4">
                      <div className="flex items-center gap-4">
                        <ScoreDial score={score.trc} grade={score.grade} size={132} />
                        <div className="min-w-0 flex-1 space-y-1.5">
                          {score.pillars.map((p) => (
                            <div key={p.key} className="flex items-center gap-2">
                              <span className="w-[112px] shrink-0 truncate text-[11.5px] text-ink-300">{p.label}</span>
                              <span className="h-1.5 flex-1 rounded-full bg-ink-700 overflow-hidden">
                                <span className="block h-full rounded-full transition-all duration-500" style={{ width: `${p.score}%`, background: scoreColour(p.score) }} />
                              </span>
                              <span className="tabular w-[26px] text-right text-[11.5px] font-bold" style={{ color: scoreColour(p.score) }}>{p.score}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <CtrBand estimate={score.ctrEstimate} />
                        <AxesPlot axes={score.axes} />
                      </div>

                      {score.critique && (
                        <div className="panel-tight p-3.5">
                          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-accent-500 mb-1.5">Claude's read</p>
                          <p className="text-[12.5px] leading-relaxed text-ink-200">{score.critique.verdict}</p>
                          {score.critique.oneChange && (
                            <p className="mt-2 text-[12.5px] leading-relaxed">
                              <span className="font-bold text-ink-100">One change: </span>
                              <span className="text-ink-300">{score.critique.oneChange}</span>
                            </p>
                          )}
                          {score.critique.risks.length > 0 && (
                            <ul className="mt-2 list-disc pl-4 space-y-0.5 text-[12px] text-ink-400">
                              {score.critique.risks.map((r, i) => <li key={i}>{r}</li>)}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </Section>

                {score && shelf && (
                  <Section title="Shelf simulation" subtitle="Your pair dropped into the live result set.">
                    <ShelfSimulation score={score} title={title} thumbUrl={active.renderAssetUrl} competitors={shelf.videos} />
                  </Section>
                )}

                {score && (
                  <Section title="Ranked fixes" subtitle="Ordered by the points each change is worth.">
                    <FixList fixes={score.fixes} />
                  </Section>
                )}

                {score && (
                  <Section title="Full breakdown">
                    <div className="space-y-2">
                      {score.pillars.map((p) => <PillarCard key={p.key} pillar={p} />)}
                    </div>
                  </Section>
                )}
              </div>
            </div>
          )}

          {source && (
            <div className="mt-4">
              <TitleLab
                sourceVideoId={source.id}
                keyword={keyword}
                currentTitle={title}
                shelfId={shelf?.id ?? null}
                onPick={(t) => setTitle(t)}
                onCredits={refreshMe}
              />
            </div>
          )}
        </>
      )}

      {step === "input" && variants.length === 0 && (
        <Empty title="Nothing generated yet">
          Paste a URL or describe the video above. With no API keys configured the studio still works end to end —
          it uses local art direction and the deterministic scoring engine.
        </Empty>
      )}
    </div>
  );
}
