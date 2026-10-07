"use client";

import { useEffect, useState } from "react";
import { api, type MeResponse } from "@/lib/client";
import { Banner, PageHeader, Section, Spinner, Stat } from "@/components/ui";

export function UpgradeClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => api.get<MeResponse>("/api/me").then(setMe).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const upgrade = async (plan: string) => {
    setBusy(plan);
    setError(null);
    try {
      const res = await api.post<{ mode: string; checkoutUrl?: string; message?: string }>(
        "/api/billing/checkout",
        { plan },
      );
      if (res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
        return;
      }
      setMessage(res.message ?? "Plan updated.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the upgrade.");
    } finally {
      setBusy(null);
    }
  };

  const used = me ? me.plan.credits - me.user.creditsRemaining : 0;

  return (
    <div className="mx-auto max-w-[1340px] p-5 sm:p-7">
      <PageHeader
        eyebrow="Plan & credits"
        title="Thumbnails is an upgrade tier on your TubeRadar account"
        subtitle="Your existing TubeRadar sign-in carries over. Credits meter the expensive work — image generation and AI critique — while scoring, editing and shelf analysis stay cheap on purpose, because those are the things you should be doing constantly."
      />

      {error && <div className="mb-4"><Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner></div>}
      {message && <div className="mb-4"><Banner tone="good" onDismiss={() => setMessage(null)}>{message}</Banner></div>}

      {!me ? (
        <div className="flex items-center gap-2 text-[13px] text-ink-400"><Spinner /> Loading…</div>
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Current plan" value={me.plan.name} hint={me.plan.priceGbp === 0 ? "No upgrade active." : `£${me.plan.priceGbp}/month`} />
            <Stat
              label="Credits left"
              value={me.user.creditsRemaining.toLocaleString()}
              hint={`of ${me.plan.credits.toLocaleString()} this period`}
              tone={me.user.creditsRemaining / me.plan.credits > 0.35 ? "good" : me.user.creditsRemaining / me.plan.credits > 0.12 ? "warn" : "bad"}
            />
            <Stat label="Used this period" value={used.toLocaleString()} hint={`Period started ${new Date(me.user.periodStart).toLocaleDateString("en-GB")}`} />
            <Stat label="Saved winners" value={me.stats.winners} hint={`${me.stats.scores} scores run`} />
          </div>

          {!me.capabilities.billing && (
            <div className="mb-5">
              <Banner tone="info" title="Billing not wired up on this deployment">
                <code className="text-ink-200">STRIPE_SECRET_KEY</code> is not set, so switching tiers below applies the plan
                locally. That is deliberate — it lets you exercise every gated surface before connecting payments.
              </Banner>
            </div>
          )}

          <div className="mb-5 grid gap-4 lg:grid-cols-4">
            {me.plans.map((plan) => {
              const current = plan.id === me.user.plan;
              return (
                <article
                  key={plan.id}
                  className={`panel p-5 flex flex-col ${current ? "ring-2 ring-accent-500" : ""} ${plan.id === "studio" ? "lg:-mt-2 lg:mb-[-0.5rem]" : ""}`}
                >
                  {plan.id === "studio" && (
                    <span className="chip mb-3 self-start border-brand-500/40 bg-brand-500/12 text-brand-400">Most popular</span>
                  )}
                  <h3 className="text-[16px] font-extrabold tracking-tight">{plan.name}</h3>
                  <p className="mt-1.5 text-[27px] font-extrabold leading-none tabular">
                    {plan.priceGbp === 0 ? "Included" : <>£{plan.priceGbp}<span className="text-[13px] font-bold text-ink-400">/mo</span></>}
                  </p>
                  <p className="mt-1.5 text-[12px] text-ink-400 tabular">{plan.credits.toLocaleString()} credits / month</p>

                  <ul className="mt-4 flex-1 space-y-1.5">
                    {plan.features.map((f) => (
                      <li key={f} className="flex gap-2 text-[12.5px] leading-snug text-ink-300">
                        <span className="text-good-500 shrink-0">✓</span>{f}
                      </li>
                    ))}
                  </ul>

                  <dl className="mt-4 hairline pt-3 space-y-1 text-[11.5px] text-ink-400">
                    <div className="flex justify-between"><dt>Variants per run</dt><dd className="tabular text-ink-200">{plan.limits.variantsPerRun}</dd></div>
                    <div className="flex justify-between"><dt>Shelf depth</dt><dd className="tabular text-ink-200">{plan.limits.competitorDepth}</dd></div>
                    <div className="flex justify-between"><dt>Saved winners</dt><dd className="tabular text-ink-200">{plan.limits.savedWinners.toLocaleString()}</dd></div>
                    <div className="flex justify-between"><dt>Brand kits</dt><dd className="tabular text-ink-200">{plan.limits.brandKits || "—"}</dd></div>
                    <div className="flex justify-between"><dt>API access</dt><dd className="text-ink-200">{plan.limits.apiAccess ? "Yes" : "—"}</dd></div>
                  </dl>

                  <button
                    className={`btn mt-4 w-full ${current ? "btn-ghost" : plan.id === "studio" ? "btn-primary" : "btn-ghost"}`}
                    disabled={current || plan.id === "free" || busy !== null}
                    onClick={() => upgrade(plan.id)}
                  >
                    {busy === plan.id ? <><Spinner /> Starting</> : current ? "Current plan" : plan.id === "free" ? "Included" : `Switch to ${plan.name.replace("Thumbnails ", "")}`}
                  </button>
                </article>
              );
            })}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="What a credit buys" subtitle="Metering is published, not hidden. Scoring stays cheap because you should do it constantly.">
              <ul className="divide-y divide-ink-700">
                {Object.entries(me.creditCosts).map(([action, cost]) => (
                  <li key={action} className="flex items-baseline justify-between gap-3 py-2">
                    <span className="text-[12.5px] text-ink-300">{LABELS[action] ?? action}</span>
                    <span className="tabular text-[12.5px] font-bold">{cost} {cost === 1 ? "credit" : "credits"}</span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Recent activity" subtitle="Every spend is itemised — your balance is always explainable.">
              {me.recentLedger.length === 0 ? (
                <p className="text-[12.5px] text-ink-400">Nothing spent yet this period.</p>
              ) : (
                <ul className="divide-y divide-ink-700">
                  {me.recentLedger.map((l, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-300">{LABELS[l.action] ?? l.action}</span>
                      <span className="text-[11px] text-ink-500 tabular shrink-0">{new Date(l.at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      <span className={`tabular w-[48px] text-right text-[12.5px] font-bold shrink-0 ${l.delta < 0 ? "text-ink-200" : "text-good-400"}`}>
                        {l.delta > 0 ? "+" : ""}{l.delta}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </>
      )}
    </div>
  );
}

const LABELS: Record<string, string> = {
  source_video: "Read a YouTube URL (metadata + baseline analysis)",
  competitor_shelf: "Fetch & analyse a competitor shelf",
  concepts: "Claude thumbnail concepts",
  image_variant: "Generate one thumbnail variant",
  render: "Re-render after an edit",
  titles: "Claude title variant batch",
  score: "Score a title + thumbnail pair",
  score_ai: "Score with Claude's visual critique",
};
