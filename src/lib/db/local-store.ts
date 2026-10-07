import fs from "node:fs/promises";
import path from "node:path";
import {
  matches,
  paginate,
  sortRows,
  type ListOptions,
  type Row,
  type Store,
} from "./store";
import type { ID, TableName } from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const BLOB_DIR = path.join(DATA_DIR, "assets");

/**
 * Zero-dependency JSON store.
 *
 * Writes are serialised through a per-table promise chain and land via
 * write-to-temp + rename, so a crash mid-write can never leave a truncated
 * table behind. Good enough for local dev, demos and single-instance
 * self-hosting; production points at Supabase instead.
 */
export class LocalStore implements Store {
  readonly kind = "local" as const;
  private cache = new Map<string, unknown[]>();
  private chains = new Map<string, Promise<unknown>>();
  private ready: Promise<void>;

  constructor() {
    this.ready = this.ensureDirs();
  }

  /**
   * Idempotent directory creation, run before every write rather than once at
   * construction. `mkdir -p` on an existing directory is a cheap no-op, and
   * doing it per-write makes the store self-healing: if `.data` is deleted
   * underneath a running process (a cleanup script, a stale container volume)
   * the next write recreates it instead of failing with ENOENT forever.
   */
  private async ensureDirs() {
    await fs.mkdir(BLOB_DIR, { recursive: true });
  }

  private file(table: string) {
    return path.join(DATA_DIR, `${table}.json`);
  }

  /** Serialise all mutations on a table so concurrent requests can't clobber. */
  private queue<R>(table: string, fn: () => Promise<R>): Promise<R> {
    const prev = this.chains.get(table) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(
      table,
      next.catch(() => undefined),
    );
    return next;
  }

  private async read<T extends TableName>(table: T): Promise<Row<T>[]> {
    await this.ready;
    const cached = this.cache.get(table);
    if (cached) return cached as Row<T>[];
    try {
      const raw = await fs.readFile(this.file(table), "utf8");
      const parsed = JSON.parse(raw) as Row<T>[];
      const rows = Array.isArray(parsed) ? parsed : [];
      this.cache.set(table, rows);
      return rows;
    } catch {
      // No file yet, or it was removed underneath us. Either way the truth is
      // "empty" — caching a stale row set here would hand out ids whose blobs
      // are gone.
      this.cache.set(table, []);
      return [];
    }
  }

  private async write<T extends TableName>(table: T, rows: Row<T>[]) {
    this.cache.set(table, rows);
    await this.ensureDirs();
    const target = this.file(table);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(rows, null, 2), "utf8");
    await fs.rename(tmp, target);
  }

  async insert<T extends TableName>(table: T, row: Row<T>): Promise<Row<T>> {
    return this.queue(table, async () => {
      const rows = await this.read(table);
      rows.push(row);
      await this.write(table, rows);
      return row;
    });
  }

  async insertMany<T extends TableName>(
    table: T,
    incoming: Row<T>[],
  ): Promise<Row<T>[]> {
    if (incoming.length === 0) return [];
    return this.queue(table, async () => {
      const rows = await this.read(table);
      rows.push(...incoming);
      await this.write(table, rows);
      return incoming;
    });
  }

  async get<T extends TableName>(table: T, id: ID): Promise<Row<T> | null> {
    const rows = await this.read(table);
    return (
      (rows.find((r) => (r as { id: ID }).id === id) as Row<T> | undefined) ??
      null
    );
  }

  async find<T extends TableName>(
    table: T,
    opts: ListOptions<T>,
  ): Promise<Row<T> | null> {
    const rows = await this.list(table, { ...opts, limit: 1 });
    return rows[0] ?? null;
  }

  async list<T extends TableName>(
    table: T,
    opts?: ListOptions<T>,
  ): Promise<Row<T>[]> {
    const rows = await this.read(table);
    const filtered = rows.filter((r) => matches<T>(r, opts?.where));
    return paginate<T>(sortRows<T>(filtered, opts), opts);
  }

  async update<T extends TableName>(
    table: T,
    id: ID,
    patch: Partial<Row<T>>,
  ): Promise<Row<T> | null> {
    return this.queue(table, async () => {
      const rows = await this.read(table);
      const idx = rows.findIndex((r) => (r as { id: ID }).id === id);
      if (idx === -1) return null;
      const next = { ...rows[idx], ...patch } as Row<T>;
      rows[idx] = next;
      await this.write(table, rows);
      return next;
    });
  }

  async remove<T extends TableName>(table: T, id: ID): Promise<boolean> {
    return this.queue(table, async () => {
      const rows = await this.read(table);
      const idx = rows.findIndex((r) => (r as { id: ID }).id === id);
      if (idx === -1) return false;
      rows.splice(idx, 1);
      await this.write(table, rows);
      return true;
    });
  }

  async count<T extends TableName>(
    table: T,
    opts?: ListOptions<T>,
  ): Promise<number> {
    const rows = await this.read(table);
    return rows.filter((r) => matches<T>(r, opts?.where)).length;
  }

  /* ───────────────────────────── blob storage ───────────────────────────── */

  private blobPath(key: string) {
    // Flatten and sanitise: the key never escapes .data/assets.
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(BLOB_DIR, safe);
  }

  async putBlob(key: string, data: Buffer, _mime: string): Promise<string> {
    await this.ensureDirs();
    await fs.writeFile(this.blobPath(key), data);
    return key;
  }

  async getBlob(key: string) {
    try {
      const data = await fs.readFile(this.blobPath(key));
      const mime = key.endsWith(".jpg") || key.endsWith(".jpeg")
        ? "image/jpeg"
        : key.endsWith(".webp")
          ? "image/webp"
          : "image/png";
      return { data, mime };
    } catch {
      return null;
    }
  }

  async deleteBlob(key: string) {
    await fs.rm(this.blobPath(key), { force: true });
  }
}
