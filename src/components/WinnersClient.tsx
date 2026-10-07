"use client";

import { useEffect, useState } from "react";
import { api, type WinnersResponse } from "@/lib/client";
import { Banner, CopyButton, Empty, PageHeader, Section, Spinner, Stat, ThumbPreview } from "@/components/ui";
import { scoreColour } from "@/components/score/ScoreVisuals";

type Winner = WinnersResponse["winners"][number];

export function WinnersClient() {
  const [data, setData] = useState<WinnersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [ctr, setCtr] = useState("");
  const [views, setViews] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.get<WinnersResponse>("/api/winners").then(setData).catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);

  const record = async (w: Winner) => {
    setBusy(true);
    try {
      await api.patch(`/api/winners/${w.id}`, {
        actual: {
          ctr: ctr.trim() ? Number(ctr) : null,
          views: views.trim() ? Number(views) : null,
        },
      });
      setEditing(null);
      setCtr("");
      setViews("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that result.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.del(`/api/winners/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that winner.");
    }
  };

  const withActuals = data?.winners.filter((w) => w.actual?.ctr != null) ?? [];
  const avgPredicted = withActuals.length
    ? withActuals.reduce((a, w) => a + w.trc, 0) / withActuals.length
    : null;
  const avgActual = withActuals.length
    ? withActuals.reduce((a, w) => a + (w.actual?.ctr ?? 0), 0) / withActuals.length
    : null;

  return (
    <div className="mx-auto max-w-[1340px] p-5 sm:p-7">
      <PageHeader
        eyebrow="Winners"
        title="Your saved pairings"
        subtitle="Everything you decided to keep, with the score it earned. Record the real CTR after publishing — predicted versus actual is the only honest way to know whether the model is working for your audience."
      />

      {error && <div className="mb-4"><Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner></div>}

      {!data ? (
        <div className="flex items-center gap-2 text-[13px] text-ink-400"><Spinner /> Loading your library…</div>
      ) : data.winners.length === 0 ? (
        <Empty title="Nothing saved yet" action={<a className="btn btn-primary" href="/studio">Open the studio</a>}>
          Score a pairing in the studio or the scorer, then save it here. Saved winners keep their full score so you
          can compare what worked across uploads.
        </Empty>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Saved" value={data.winners.length} hint={`${data.planLimit.toLocaleString()} allowed on your plan.`} />
            <Stat
              label="Average score"
              value={(data.winners.reduce((a, w) => a + w.trc, 0) / data.winners.length).toFixed(1)}
            />
            <Stat
              label="Results recorded"
              value={withActuals.length}
              hint={withActuals.length === 0 ? "Record one to start calibrating." : "Used to calibrate the CTR model."}
            />
            <Stat
              label="Avg actual CTR"
              value={avgActual !== null ? `${avgActual.toFixed(1)}%` : "—"}
              hint={avgPredicted !== null ? `At an average TRC of ${avgPredicted.toFixed(0)}.` : undefined}
              tone={avgActual !== null ? (avgActual >= 5 ? "good" : avgActual >= 3 ? "warn" : "bad") : "default"}
            />
          </div>

          <Section>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data.winners.map((w) => (
                <article key={w.id} className="panel-tight overflow-hidden">
                  <div className="relative">
                    <ThumbPreview src={w.renderAssetUrl} alt={w.label} className="!rounded-none" />
                    <span
                      className="absolute right-2 top-2 rounded-[6px] px-2 py-0.5 text-[12px] font-extrabold tabular"
                      style={{ background: `${scoreColour(w.trc)}26`, color: scoreColour(w.trc), backdropFilter: "blur(6px)" }}
                    >
                      {Math.round(w.trc)}
                    </span>
                  </div>

                  <div className="p-3">
                    <p className="text-[13px] font-semibold leading-snug">{w.title_text}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-400">
                      {w.keyword && <span className="chip">{w.keyword}</span>}
                      <span className="tabular">{new Date(w.created_at).toLocaleDateString("en-GB")}</span>
                    </div>

                    {w.actual?.ctr != null ? (
                      <div className="mt-2.5 rounded-[8px] bg-good-500/10 px-2.5 py-2">
                        <p className="text-[11.5px] font-bold text-good-400">
                          Actual: {w.actual.ctr}% CTR
                          {w.actual.views != null && ` · ${Intl.NumberFormat("en", { notation: "compact" }).format(w.actual.views)} views`}
                        </p>
                        <p className="mt-0.5 text-[10.5px] text-ink-400">
                          Recorded {new Date(w.actual.recorded_at).toLocaleDateString("en-GB")}
                        </p>
                      </div>
                    ) : editing === w.id ? (
                      <div className="mt-2.5 space-y-2">
                        <div className="flex gap-2">
                          <input className="field !py-1.5 !text-[12px]" placeholder="CTR %" value={ctr} onChange={(e) => setCtr(e.target.value)} inputMode="decimal" />
                          <input className="field !py-1.5 !text-[12px]" placeholder="Views" value={views} onChange={(e) => setViews(e.target.value)} inputMode="numeric" />
                        </div>
                        <div className="flex gap-1.5">
                          <button className="btn btn-accent btn-sm flex-1" onClick={() => record(w)} disabled={busy}>
                            {busy ? <Spinner /> : "Save result"}
                          </button>
                          <button className="btn btn-quiet btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button className="btn btn-ghost btn-sm mt-2.5 w-full" onClick={() => { setEditing(w.id); setCtr(""); setViews(""); }}>
                        Record the real result
                      </button>
                    )}

                    <div className="mt-2 flex items-center gap-1">
                      <CopyButton text={w.title_text} className="flex-1" />
                      {w.renderAssetUrl && (
                        <a className="btn btn-quiet btn-sm flex-1" href={w.renderAssetUrl} download={`${w.label}.png`}>Download</a>
                      )}
                      <button className="btn btn-quiet btn-sm text-bad-400" onClick={() => remove(w.id)} aria-label="Delete">✕</button>
                    </div>
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
