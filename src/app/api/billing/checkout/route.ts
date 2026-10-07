import * as z from "zod";
import { config, PLANS, capabilities, type PlanId } from "@/lib/config";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { newId, nowIso } from "@/lib/util/ids";
import { handleError, fail, ok, parseBody } from "@/lib/api";

export const runtime = "nodejs";

const Body = z.object({ plan: z.enum(["creator", "studio", "agency"]) });

/**
 * Start an upgrade.
 *
 * With Stripe configured this creates a real Checkout session against the
 * existing TubeRadar customer. Without it, the upgrade is applied locally so
 * the whole gated surface — higher variant counts, deeper shelves, A/B tools —
 * is testable before billing is wired up.
 */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req, Body);
    const user = await getSessionUser();
    const plan = PLANS[body.plan as PlanId];
    if (!plan) return fail("Unknown plan.", "invalid_request", 422);

    if (capabilities().billing) {
      const priceId = config.stripe.prices[body.plan];
      if (!priceId) {
        return fail(
          `No Stripe price id configured for the ${plan.name} tier. Set STRIPE_PRICE_THUMBS_${body.plan.toUpperCase()}.`,
          "billing_not_configured",
          501,
        );
      }

      const params = new URLSearchParams({
        mode: "subscription",
        "line_items[0][price]": priceId,
        "line_items[0][quantity]": "1",
        success_url: `${config.appUrl}/upgrade?status=success&plan=${body.plan}`,
        cancel_url: `${config.appUrl}/upgrade?status=cancelled`,
        client_reference_id: user.id,
        "metadata[tuberadar_user_id]": user.id,
        "metadata[module]": "thumbnails",
      });
      if (user.stripe_customer_id) params.set("customer", user.stripe_customer_id);
      else params.set("customer_email", user.email);

      const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.stripe.secretKey}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: params,
      });
      const json = (await res.json()) as { url?: string; error?: { message?: string } };
      if (!res.ok || !json.url) {
        return fail(json.error?.message ?? "Stripe did not return a checkout URL.", "stripe_error", 502);
      }
      return ok({ mode: "stripe", checkoutUrl: json.url });
    }

    // Local/dev upgrade so the gated surface is testable without billing keys.
    const store = db();
    const updated = await store.update("users", user.id, {
      plan: plan.id,
      credits_remaining: plan.credits,
      period_start: nowIso(),
    });
    await store.insert("credit_ledger", {
      id: newId("led"),
      user_id: user.id,
      delta: plan.credits - user.credits_remaining,
      action: `plan_change:${plan.id}`,
      balance_after: plan.credits,
      note: "Local upgrade — Stripe is not configured on this deployment.",
      created_at: nowIso(),
    });

    return ok({
      mode: "local",
      plan: updated?.plan ?? plan.id,
      creditsRemaining: updated?.credits_remaining ?? plan.credits,
      message: `Switched to ${plan.name} locally. Configure STRIPE_SECRET_KEY to take real payments.`,
    });
  } catch (err) {
    return handleError(err);
  }
}
