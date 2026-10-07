"use client";

import { useState } from "react";
import { api, type TitlesResponse } from "@/lib/client";
import { Banner, CopyButton, Empty, Field, Section, Spinner } from "@/components/ui";
import { scoreColour } from "@/components/score/ScoreVisuals";
import { TITLE_ARCHETYPES } from "@/lib/scoring/lexicon";

/**
 * Title lab.
 *
 * Variants arrive pre-scored by the same title pillar the full scorer uses, so
 * the ranking here and the number on the scorer can never disagree — which is
 * the usual way these tools lose trust.
 */
export function TitleLab({
  sourceVideoId, keyword, currentTitle, shelfId, onPick, onCredits,
}: {
  sourceVideoId: string;
  keyword: string;
  currentTitle: string;
  shelfId: string | null;
  onPick: (title: string) => void;
  onCredits?: () => void;
}) {
  const [titles, setTitles] = useState<TitlesResponse["titles"]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archetype, setArchetype] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<TitlesResponse>("/api/titles/generate", {
        sourceVideoId,
        keyword: keyword.trim() || undefined,
        currentTitle: currentTitle.trim() || undefined,
        shelfId: shelfId ?? undefined,
        archetype: archetype || undefined,
        count: 10,
      });
      setTitles(res.titles);
      setNote(res.note ?? null);
      onCredits?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate titles.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Title lab"
      subtitle="Ten hooks built against this shelf's wording, ranked by the title pillar."
      actions={
        <button className="btn btn-accent btn-sm" onClick={generate} disabled={busy}>
          {busy ? <><Spinner /> Writing</> : titles.length ? "Regenerate" : "Generate titles"}
        </button>
      }
    >
      <div className="mb-3 max-w-xs">
        <Field label="Bias towards an archetype" hint="Optional — leave blank for a spread.">
          <select className="field" value={archetype} onChange={(e) => setArchetype(e.target.value)}>
            <option value="">Mixed (recommended)</option>
            {TITLE_ARCHETYPES.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
        </Field>
      </div>

      {error && <div className="mb-3"><Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner></div>}
      {note && <div className="mb-3"><Banner tone="warn" onDismiss={() => setNote(null)}>{note}</Banner></div>}

      {titles.length === 0 ? (
        <Empty title="No titles yet">
          Generate a set and the strongest hooks rise to the top. Click one to load it into the scorer.
        </Empty>
      ) : (
        <ol className="space-y-2">
          {titles.map((t) => (
            <li key={t.id} className="panel-tight p-3">
              <div className="flex items-start gap-3">
                <span
                  className="tabular grid h-8 w-8 shrink-0 place-items-center rounded-[7px] text-[13px] font-extrabold"
                  style={{ background: `${scoreColour(t.pillar.score)}1f`, color: scoreColour(t.pillar.score) }}
                >
                  {t.pillar.score}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold leading-snug">{t.text}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-400">
                    <span className="chip">{t.archetype}</span>
                    <span className="tabular">{t.text.length} ch</span>
                    {t.text.length > 48 && <span className="text-warn-400">cut on mobile</span>}
                  </p>
                  {t.rationale && <p className="mt-1.5 text-[12px] leading-relaxed text-ink-400">{t.rationale}</p>}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <button className="btn btn-ghost btn-sm" onClick={() => onPick(t.text)}>Use</button>
                  <CopyButton text={t.text} />
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
