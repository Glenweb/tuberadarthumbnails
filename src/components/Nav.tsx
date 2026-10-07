"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type MeResponse } from "@/lib/client";

const LINKS = [
  { href: "/", label: "Overview", hint: "Where you stand" },
  { href: "/studio", label: "Studio", hint: "Generate & edit" },
  { href: "/score", label: "Scorer", hint: "Pair + shelf rank" },
  { href: "/competitors", label: "Shelf", hint: "Competitor grid" },
  { href: "/winners", label: "Winners", hint: "Saved library" },
  { href: "/upgrade", label: "Plan", hint: "Credits & tiers" },
];

export function Nav() {
  const pathname = usePathname();
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => api.get<MeResponse>("/api/me").then((d) => active && setMe(d)).catch(() => undefined);
    load();
    // Credits change as the user works; refresh when they come back to the tab.
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [pathname]);

  const credits = me?.user.creditsRemaining ?? null;
  const allowance = me?.plan.credits ?? 1;
  const pctLeft = credits === null ? 100 : Math.max(0, Math.min(100, (credits / allowance) * 100));

  return (
    <nav className="lg:w-[244px] lg:shrink-0 lg:border-r border-b lg:border-b-0 border-ink-700 bg-ink-900/70 backdrop-blur-xl lg:min-h-dvh">
      <div className="lg:sticky lg:top-0 flex lg:flex-col gap-3 p-4 lg:h-dvh overflow-x-auto lg:overflow-visible">
        <Link href="/" className="flex items-center gap-2.5 shrink-0 lg:mb-2">
          <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-brand-500 text-white font-extrabold text-lg">T</span>
          <span className="leading-tight">
            <span className="block text-[13px] font-extrabold tracking-tight">TubeRadar</span>
            <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-accent-500">Thumbnails</span>
          </span>
        </Link>

        <ul className="flex lg:flex-col gap-1 flex-1">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className={`block rounded-[9px] px-3 py-2 transition-colors ${
                    active ? "bg-ink-700 text-ink-100" : "text-ink-300 hover:bg-ink-800 hover:text-ink-100"
                  }`}
                >
                  <span className="block text-[13px] font-semibold">{l.label}</span>
                  <span className="hidden lg:block text-[11px] text-ink-400">{l.hint}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="hidden lg:block panel-tight p-3 shrink-0">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-400">Credits</span>
            <span className="tabular text-[13px] font-bold">
              {credits === null ? "—" : credits.toLocaleString()}
            </span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-ink-700 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                pctLeft > 35 ? "bg-good-500" : pctLeft > 12 ? "bg-warn-500" : "bg-bad-500"
              }`}
              style={{ width: `${pctLeft}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-ink-400 truncate">{me?.plan.name ?? "…"}</span>
            <Link href="/upgrade" className="text-[11px] font-bold text-accent-500 hover:text-accent-400">
              Upgrade
            </Link>
          </div>
        </div>

        {me && (
          <div className="hidden lg:flex items-center gap-1.5 text-[10px] text-ink-400 shrink-0">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                me.capabilities.claude && me.capabilities.imageGen && me.capabilities.youtubeData
                  ? "bg-good-500"
                  : me.capabilities.claude || me.capabilities.imageGen || me.capabilities.youtubeData
                    ? "bg-warn-500"
                    : "bg-ink-500"
              }`}
            />
            <span className="truncate">{me.mode}</span>
          </div>
        )}
      </div>
    </nav>
  );
}
