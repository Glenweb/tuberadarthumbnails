import { NextResponse } from "next/server";
import * as z from "zod";
import { InsufficientCreditsError } from "@/lib/credits";

export type ApiError = { error: string; code: string; detail?: unknown };

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(message: string, code: string, status = 400, detail?: unknown) {
  return NextResponse.json({ error: message, code, detail } satisfies ApiError, { status });
}

/**
 * One place where every route's failure modes are translated into a response.
 * Keeps handlers to their happy path and guarantees the client always receives
 * a machine-readable `code` alongside a message meant for a human.
 */
export function handleError(err: unknown) {
  if (err instanceof InsufficientCreditsError) {
    return fail(err.message, "insufficient_credits", 402, {
      required: err.required,
      remaining: err.remaining,
      action: err.action,
    });
  }
  if (err instanceof z.ZodError) {
    return fail("The request body did not match what this endpoint expects.", "invalid_request", 422, err.issues);
  }
  console.error("[api] unhandled error:", err);
  return fail(
    err instanceof Error ? err.message : "Something went wrong handling that request.",
    "internal_error",
    500,
  );
}

export async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new z.ZodError([
      { code: "custom", message: "Body must be valid JSON.", path: [] },
    ]);
  }
  return schema.parse(raw);
}
