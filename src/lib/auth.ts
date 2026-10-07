import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { PLANS, capabilities, config, type PlanId } from "@/lib/config";
import { db } from "@/lib/db";
import type { TrtUser } from "@/lib/db/types";
import { newId, nowIso } from "@/lib/util/ids";

const DEV_COOKIE = "trt_dev_uid";
const PERIOD_DAYS = 30;

/**
 * Resolve the acting user.
 *
 * In production this reads the existing TubeRadar Supabase session cookie, so a
 * user who is already signed in to TubeRadar is signed in here with no second
 * login — the module is an upgrade tier, not a separate product. Locally it
 * issues a persistent demo identity so the whole app is usable immediately.
 */
export async function getSessionUser(): Promise<TrtUser> {
  const store = db();

  if (capabilities().store === "supabase" && config.supabase.url && config.supabase.anonKey) {
    try {
      const jar = await cookies();
      const supabase = createServerClient(config.supabase.url, config.supabase.anonKey, {
        cookies: {
          getAll: () => jar.getAll(),
          // Route handlers may run in a context where cookies are immutable;
          // this module never needs to mutate the session, only read it.
          setAll: () => undefined,
        },
      });
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        const existing = await store.get("users", data.user.id);
        if (existing) return refillIfDue(existing);
        return store.insert("users", {
          id: data.user.id,
          email: data.user.email ?? "unknown@tuberadar.app",
          display_name:
            (data.user.user_metadata?.full_name as string | undefined) ??
            data.user.email?.split("@")[0] ??
            null,
          plan: "free",
          credits_remaining: PLANS.free.credits,
          period_start: nowIso(),
          stripe_customer_id: null,
          created_at: nowIso(),
        });
      }
    } catch (err) {
      console.warn("[auth] Supabase session read failed, falling back to local identity:", err);
    }
  }

  return getLocalUser();
}

async function getLocalUser(): Promise<TrtUser> {
  const store = db();
  let id: string | undefined;
  try {
    const jar = await cookies();
    id = jar.get(DEV_COOKIE)?.value;
  } catch {
    // Called outside a request scope (e.g. a script) — use the shared demo user.
  }

  if (id) {
    const found = await store.get("users", id);
    if (found) return refillIfDue(found);
  }

  // One stable demo identity per workspace, so refreshing never loses work.
  const existing = await store.find("users", { where: { email: "demo@tuberadar.local" } });
  if (existing) return refillIfDue(existing);

  const plan: PlanId = config.dev.plan in PLANS ? config.dev.plan : "studio";
  return store.insert("users", {
    id: newId("user"),
    email: "demo@tuberadar.local",
    display_name: "Demo Creator",
    plan,
    credits_remaining: PLANS[plan].credits,
    period_start: nowIso(),
    stripe_customer_id: null,
    created_at: nowIso(),
  });
}

/** Roll the monthly allowance when the billing period has elapsed. */
async function refillIfDue(user: TrtUser): Promise<TrtUser> {
  const started = new Date(user.period_start).getTime();
  if (Number.isNaN(started)) return user;
  const elapsedDays = (Date.now() - started) / 86_400_000;
  if (elapsedDays < PERIOD_DAYS) return user;

  const plan = PLANS[user.plan] ?? PLANS.free;
  const updated = await db().update("users", user.id, {
    credits_remaining: plan.credits,
    period_start: nowIso(),
  });
  return updated ?? user;
}

/** Set the local dev identity cookie — used by the workspace switcher. */
export async function setLocalUser(id: string) {
  const jar = await cookies();
  jar.set(DEV_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
