/**
 * Minimal loader hook so plain `node --experimental-strip-types` can run the
 * module's TypeScript sources directly: it resolves the `@/*` path alias and
 * the extensionless relative imports that TypeScript allows.
 * Used by scripts/smoke.mjs — the app itself goes through Next's own resolver.
 */
import { statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = process.cwd();

function firstFile(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const hit = firstFile(path.join(ROOT, "src", specifier.slice(2)));
    if (hit) return next(pathToFileURL(hit).href, context);
  }
  if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
    const fromDir = context.parentURL
      ? path.dirname(fileURLToPath(context.parentURL))
      : ROOT;
    const hit = firstFile(path.resolve(fromDir, specifier));
    if (hit) return next(pathToFileURL(hit).href, context);
  }
  return next(specifier, context);
}
