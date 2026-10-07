import { capabilities, CREDIT_COSTS, modeLabel, PLANS } from "@/lib/config";
import { getSessionUser } from "@/lib/auth";
import { ledger } from "@/lib/credits";
import { db } from "@/lib/db";
import { handleError, ok } from "@/lib/api";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getSessionUser();
    const plan = PLANS[user.plan] ?? PLANS.free;
    const [winners, variants, scores] = await Promise.all([
      db().count("winners", { where: { user_id: user.id } }),
      db().count("variants", { where: { user_id: user.id } }),
      db().count("scores", { where: { user_id: user.id } }),
    ]);
    return ok({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        plan: user.plan,
        creditsRemaining: user.credits_remaining,
        periodStart: user.period_start,
      },
      plan,
      plans: Object.values(PLANS),
      creditCosts: CREDIT_COSTS,
      capabilities: capabilities(),
      mode: modeLabel(),
      stats: { winners, variants, scores },
      recentLedger: (await ledger(user.id, 12)).map((l) => ({
        action: l.action, delta: l.delta, balanceAfter: l.balance_after, at: l.created_at,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}
