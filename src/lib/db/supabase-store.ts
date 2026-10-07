import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "@/lib/config";
import type { ListOptions, Row, Store } from "./store";
import type { ID, TableName } from "./types";

/** Logical table name → physical table in the TubeRadar Postgres schema. */
const TABLE_MAP: Record<TableName, string> = {
  users: "trt_users",
  credit_ledger: "trt_credit_ledger",
  channels: "trt_channels",
  source_videos: "trt_source_videos",
  shelves: "trt_competitor_shelves",
  variants: "trt_thumbnail_variants",
  titles: "trt_title_variants",
  scores: "trt_pair_scores",
  winners: "trt_saved_winners",
  assets: "trt_assets",
};

/**
 * Production store: the main TubeRadar Supabase project.
 *
 * Uses the service-role key on the server so the module can write on behalf of
 * a user whose identity we have already verified from the Supabase session
 * cookie. Row-level security policies (see supabase/migrations) still gate any
 * direct client access, so a leaked anon key cannot read another tenant's work.
 */
export class SupabaseStore implements Store {
  readonly kind = "supabase" as const;
  private client: SupabaseClient;
  private bucket: string;

  constructor() {
    if (!config.supabase.url || !config.supabase.serviceKey) {
      throw new Error("SupabaseStore requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    }
    this.client = createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.bucket = config.supabase.bucket;
  }

  private from(table: TableName) {
    return this.client.from(TABLE_MAP[table]);
  }

  private applyOpts<T extends TableName>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: any,
    opts?: ListOptions<T>,
  ) {
    let q = query;
    if (opts?.where) {
      for (const [k, v] of Object.entries(opts.where)) {
        if (v === undefined) continue;
        q = Array.isArray(v) ? q.in(k, v) : v === null ? q.is(k, null) : q.eq(k, v);
      }
    }
    if (opts?.orderBy) {
      q = q.order(opts.orderBy as string, {
        ascending: opts.direction === "asc",
      });
    }
    if (opts?.limit !== undefined) {
      const start = opts.offset ?? 0;
      q = q.range(start, start + opts.limit - 1);
    } else if (opts?.offset !== undefined) {
      q = q.range(opts.offset, opts.offset + 999);
    }
    return q;
  }

  async insert<T extends TableName>(table: T, row: Row<T>): Promise<Row<T>> {
    const { data, error } = await this.from(table)
      .insert(row as never)
      .select()
      .single();
    if (error) throw new Error(`[${TABLE_MAP[table]}] insert failed: ${error.message}`);
    return data as Row<T>;
  }

  async insertMany<T extends TableName>(table: T, rows: Row<T>[]): Promise<Row<T>[]> {
    if (rows.length === 0) return [];
    const { data, error } = await this.from(table)
      .insert(rows as never)
      .select();
    if (error) throw new Error(`[${TABLE_MAP[table]}] bulk insert failed: ${error.message}`);
    return (data ?? []) as Row<T>[];
  }

  async get<T extends TableName>(table: T, id: ID): Promise<Row<T> | null> {
    const { data, error } = await this.from(table).select().eq("id", id).maybeSingle();
    if (error) throw new Error(`[${TABLE_MAP[table]}] get failed: ${error.message}`);
    return (data as Row<T> | null) ?? null;
  }

  async find<T extends TableName>(table: T, opts: ListOptions<T>): Promise<Row<T> | null> {
    const rows = await this.list(table, { ...opts, limit: 1 });
    return rows[0] ?? null;
  }

  async list<T extends TableName>(table: T, opts?: ListOptions<T>): Promise<Row<T>[]> {
    const { data, error } = await this.applyOpts<T>(this.from(table).select(), opts);
    if (error) throw new Error(`[${TABLE_MAP[table]}] list failed: ${error.message}`);
    return (data ?? []) as Row<T>[];
  }

  async update<T extends TableName>(
    table: T,
    id: ID,
    patch: Partial<Row<T>>,
  ): Promise<Row<T> | null> {
    const { data, error } = await this.from(table)
      .update(patch as never)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw new Error(`[${TABLE_MAP[table]}] update failed: ${error.message}`);
    return (data as Row<T> | null) ?? null;
  }

  async remove<T extends TableName>(table: T, id: ID): Promise<boolean> {
    const { error } = await this.from(table).delete().eq("id", id);
    if (error) throw new Error(`[${TABLE_MAP[table]}] delete failed: ${error.message}`);
    return true;
  }

  async count<T extends TableName>(table: T, opts?: ListOptions<T>): Promise<number> {
    const { count, error } = await this.applyOpts<T>(
      this.from(table).select("id", { count: "exact", head: true }),
      { ...opts, limit: undefined, offset: undefined, orderBy: undefined },
    );
    if (error) throw new Error(`[${TABLE_MAP[table]}] count failed: ${error.message}`);
    return count ?? 0;
  }

  /* ───────────────────────────── blob storage ───────────────────────────── */

  async putBlob(key: string, data: Buffer, mime: string): Promise<string> {
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(key, data, { contentType: mime, upsert: true });
    if (error) throw new Error(`storage upload failed: ${error.message}`);
    return key;
  }

  async getBlob(key: string) {
    const { data, error } = await this.client.storage.from(this.bucket).download(key);
    if (error || !data) return null;
    const buf = Buffer.from(await data.arrayBuffer());
    return { data: buf, mime: data.type || "image/png" };
  }

  async deleteBlob(key: string) {
    await this.client.storage.from(this.bucket).remove([key]);
  }
}
