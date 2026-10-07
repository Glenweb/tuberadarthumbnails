import type { TableName, Tables, ID } from "./types";

export type Row<T extends TableName> = Tables[T];

export type ListOptions<T extends TableName> = {
  /** Equality filter on any set of columns. */
  where?: Partial<Record<keyof Row<T> & string, unknown>>;
  orderBy?: keyof Row<T> & string;
  direction?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

/**
 * The only persistence surface the rest of the app knows about.
 *
 * Two implementations ship: `LocalStore` (JSON files, zero config, used for
 * local dev and demos) and `SupabaseStore` (the production target, sharing the
 * TubeRadar project's Postgres + Storage). Swapping is an env-var change.
 */
export interface Store {
  readonly kind: "local" | "supabase";

  insert<T extends TableName>(table: T, row: Row<T>): Promise<Row<T>>;
  insertMany<T extends TableName>(table: T, rows: Row<T>[]): Promise<Row<T>[]>;
  get<T extends TableName>(table: T, id: ID): Promise<Row<T> | null>;
  find<T extends TableName>(
    table: T,
    opts: ListOptions<T>,
  ): Promise<Row<T> | null>;
  list<T extends TableName>(table: T, opts?: ListOptions<T>): Promise<Row<T>[]>;
  update<T extends TableName>(
    table: T,
    id: ID,
    patch: Partial<Row<T>>,
  ): Promise<Row<T> | null>;
  remove<T extends TableName>(table: T, id: ID): Promise<boolean>;
  count<T extends TableName>(table: T, opts?: ListOptions<T>): Promise<number>;

  /** Store an image blob, returns the storage path. */
  putBlob(path: string, data: Buffer, mime: string): Promise<string>;
  /** Read an image blob back. */
  getBlob(path: string): Promise<{ data: Buffer; mime: string } | null>;
  deleteBlob(path: string): Promise<void>;
}

export function matches<T extends TableName>(
  row: Row<T>,
  where?: ListOptions<T>["where"],
): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    const actual = (row as Record<string, unknown>)[k];
    if (Array.isArray(v)) {
      if (!v.includes(actual as never)) return false;
    } else if (actual !== v) {
      return false;
    }
  }
  return true;
}

export function sortRows<T extends TableName>(
  rows: Row<T>[],
  opts?: ListOptions<T>,
): Row<T>[] {
  if (!opts?.orderBy) return rows;
  const key = opts.orderBy as string;
  const dir = opts.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = (a as Record<string, unknown>)[key];
    const bv = (b as Record<string, unknown>)[key];
    if (av === bv) return 0;
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    return av > bv ? dir : -dir;
  });
}

export function paginate<T extends TableName>(
  rows: Row<T>[],
  opts?: ListOptions<T>,
): Row<T>[] {
  const start = opts?.offset ?? 0;
  const end = opts?.limit !== undefined ? start + opts.limit : undefined;
  return rows.slice(start, end);
}
