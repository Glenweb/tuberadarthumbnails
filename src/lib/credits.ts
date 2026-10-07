import { CREDIT_COSTS, PLANS, type CreditAction } from "@/lib/config";
import { db } from "@/lib/db";
import type { TrtUser } from "@/lib/db/types";
import { newId, nowIso } from "@/lib/util/ids";

export class InsufficientCreditsError extends Error {
  constructor(
    readonly required: number,
    readonly remaining: number,
    readonly action: CreditAction,
  ) {
    super(
      `This run needs ${required} credits and ${remaining} remain. Upgrade your plan or wait for the monthly reset.`,
    );
    this.name = "InsufficientCreditsError";
  }
}

export function costOf(action: CreditAction, quantity = 1): number {
  return CREDIT_COSTS[action] * quantity;
}

/** Check affordability without mutating anything. */
export function canAfford(user: TrtUser, action: CreditAction, quantity = 1): boolean {
  return user.credits_remaining >= costOf(action, quantity);
}

/**
 * Deduct credits and write a ledger entry.
 *
 * Ledger-first accounting: every spend is attributable, so a user disputing
 * their balance gets an itemised answer instead of a shrug, and support can see
 * exactly which run consumed what.
 */
export async function spend(
  user: TrtUser,
  action: CreditAction,
  opts: { quantity?: number; note?: string } = {},
): Promise<TrtUser> {
  const quantity = opts.quantity ?? 1;
  const required = costOf(action, quantity);
  if (user.credits_remaining < required) {
    throw new InsufficientCreditsError(required, user.credits_remaining, action);
  }

  const balance = user.credits_remaining - required;
  const store = db();
  const updated = (await store.update("users", user.id, { credits_remaining: balance })) ?? {
    ...user,
    credits_remaining: balance,
  };

  await store.insert("credit_ledger", {
    id: newId("led"),
    user_id: user.id,
    delta: -required,
    action: quantity > 1 ? `${action} x${quantity}` : action,
    balance_after: balance,
    note: opts.note ?? null,
    created_at: nowIso(),
  });

  return updated;
}

/** Return credits when a metered step fails after the deduction. */
export async function refund(
  user: TrtUser,
  action: CreditAction,
  opts: { quantity?: number; note?: string } = {},
): Promise<TrtUser> {
  const amount = costOf(action, opts.quantity ?? 1);
  const plan = PLANS[user.plan] ?? PLANS.free;
  const balance = Math.min(plan.credits, user.credits_remaining + amount);
  const store = db();
  const updated = (await store.update("users", user.id, { credits_remaining: balance })) ?? {
    ...user,
    credits_remaining: balance,
  };
  await store.insert("credit_ledger", {
    id: newId("led"),
    user_id: user.id,
    delta: amount,
    action: `refund:${action}`,
    balance_after: balance,
    note: opts.note ?? "Automatic refund — the metered step did not complete.",
    created_at: nowIso(),
  });
  return updated;
}

export async function ledger(userId: string, limit = 50) {
  return db().list("credit_ledger", {
    where: { user_id: userId },
    orderBy: "created_at",
    direction: "desc",
    limit,
  });
}
