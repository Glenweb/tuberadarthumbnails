import { capabilities } from "@/lib/config";
import { LocalStore } from "./local-store";
import { SupabaseStore } from "./supabase-store";
import type { Store } from "./store";

let instance: Store | null = null;

/**
 * Process-wide store singleton. Falls back to the local JSON store if Supabase
 * is configured but unreachable, so a misconfigured env never takes the app
 * down — it just logs loudly and keeps serving.
 */
export function db(): Store {
  if (instance) return instance;
  if (capabilities().store === "supabase") {
    try {
      instance = new SupabaseStore();
      return instance;
    } catch (err) {
      console.error(
        "[tuberadar-thumbnails] Supabase store unavailable, falling back to local store:",
        err instanceof Error ? err.message : err,
      );
    }
  }
  instance = new LocalStore();
  return instance;
}

export * from "./types";
export type { Store, ListOptions } from "./store";
