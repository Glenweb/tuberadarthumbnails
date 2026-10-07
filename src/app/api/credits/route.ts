import { getSessionUser } from "@/lib/auth";
import { ledger } from "@/lib/credits";
import { PLANS } from "@/lib/config";
import { handleError, ok } from "@/lib/api";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getSessionUser();
    const plan = PLANS[user.plan] ?? PLANS.free;
    const entries = await ledger(user.id, 100);
    return ok({
      remaining: user.credits_remaining,
      allowance: plan.credits,
      plan: plan.id,
      periodStart: user.period_start,
      ledger: entries,
    });
  } catch (err) {
    return handleError(err);
  }
}
