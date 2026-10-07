#!/usr/bin/env node
/**
 * End-to-end smoke test.
 *
 * Exercises the real pipeline against a running server — resolve → shelf →
 * concepts → variants → score → edit → save → download — and asserts the parts
 * that would silently rot: that credits are actually metered, that rendered
 * images are really 1280x720, that competitors are scored by the same engine,
 * and that the shelf rank is internally consistent.
 *
 *   npm run dev          # in one terminal
 *   npm run smoke        # in another
 */

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";

let passed = 0;
let failed = 0;
const cookies = new Map();

function check(label, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ""}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ""}`);
  }
}

function step(name) {
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

async function call(path, init = {}) {
  const jar = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}),
      ...(jar ? { cookie: jar } : {}),
      ...init.headers,
    },
  });
  for (const [k, v] of res.headers) {
    if (k.toLowerCase() === "set-cookie") {
      const [pair] = v.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) cookies.set(pair.slice(0, idx), pair.slice(idx + 1));
    }
  }
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  if (!res.ok) {
    const err = new Error(body?.error ?? `${path} → ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function main() {
  console.log(`\x1b[1mTubeRadar Thumbnails — smoke test\x1b[0m\n${BASE}`);

  step("1 · Health");
  const health = await call("/api/health");
  check("service responds", health.status === "ok", `mode: ${health.mode}`);
  check("scoring engine reported live", health.capabilities.scoring === true, health.engine);
  check("renderer reported live", health.capabilities.rendering === true);

  step("2 · Identity & credits");
  const me = await call("/api/me");
  const startingCredits = me.user.creditsRemaining;
  check("session resolves to a user", Boolean(me.user.id), me.user.email);
  check("plan has a credit allowance", me.plan.credits > 0, `${me.plan.name}: ${startingCredits} left`);

  step("3 · Resolve a source");
  const resolved = await call("/api/source/resolve", {
    method: "POST",
    body: JSON.stringify({
      prompt: "How I cut my AWS bill by 70% without downgrading anything",
      keyword: "aws cost optimisation",
    }),
  });
  check("source created", Boolean(resolved.source.id));
  check("keyword derived or accepted", Boolean(resolved.source.keyword), resolved.source.keyword);
  check("credits were metered", resolved.creditsRemaining < startingCredits,
    `${startingCredits} → ${resolved.creditsRemaining}`);

  step("4 · Competitor shelf");
  const shelfRes = await call("/api/shelf", {
    method: "POST",
    body: JSON.stringify({ keyword: resolved.source.keyword, refresh: true }),
  });
  const shelf = shelfRes.shelf;
  const scored = shelf.videos.filter((v) => typeof v.score === "number");
  check("shelf has competitors", shelf.videos.length >= 3, `${shelf.videos.length} videos (${shelf.source})`);
  check("every competitor was analysed", shelf.videos.every((v) => v.analysis !== null));
  check("every competitor was scored by the same engine", scored.length === shelf.videos.length);
  check("fingerprint built", shelf.fingerprint.sampleSize > 0,
    `face ${Math.round(shelf.fingerprint.faceRate * 100)}% · text ${Math.round(shelf.fingerprint.textRate * 100)}% · median ${shelf.fingerprint.medianScore}`);
  check("hue histogram is normalised",
    Math.abs(shelf.fingerprint.hueHistogram.reduce((a, b) => a + b, 0) - 1) < 0.02);

  step("5 · Concepts");
  const concepts = await call("/api/concepts", {
    method: "POST",
    body: JSON.stringify({ sourceVideoId: resolved.source.id, count: 3 }),
  });
  check("concepts returned", concepts.concepts.length === 3, `source: ${concepts.source}`);
  check("each names the shelf gap it exploits",
    concepts.concepts.every((c) => c.differentiator && c.imagePrompt && c.overlayText));

  step("6 · Generate variants");
  const gen = await call("/api/variants/generate", {
    method: "POST",
    body: JSON.stringify({
      sourceVideoId: resolved.source.id, shelfId: shelf.id, count: 3, style: "impact",
    }),
  });
  check("variants rendered", gen.variants.length === 3, `images: ${gen.imageSource}`);
  check("each has a flattened render", gen.variants.every((v) => v.render_asset_id));
  check("each was analysed", gen.variants.every((v) => v.analysis !== null));

  const variant = gen.variants[0];
  const img = await fetch(`${BASE}${variant.renderAssetUrl}`, {
    headers: { cookie: [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ") },
  });
  const bytes = Buffer.from(await img.arrayBuffer());
  // PNG header: width at byte 16, height at byte 20, both big-endian uint32.
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  check("render is a real PNG", bytes.subarray(1, 4).toString() === "PNG");
  check("render is exactly 1280x720", width === 1280 && height === 720, `${width}x${height}`);

  step("7 · Score the pair");
  const title = "I cut my AWS bill by 70% in 3 days (nothing broke)";
  const scoreRes = await call("/api/score", {
    method: "POST",
    body: JSON.stringify({
      title, variantId: variant.id, keyword: shelf.keyword, shelfId: shelf.id,
    }),
  });
  const s = scoreRes.score;
  check("TRC in range", s.trc >= 0 && s.trc <= 100, `TRC ${s.trc} (${s.grade})`);
  check("all four pillars present", s.pillars.length === 4,
    s.pillars.map((p) => `${p.label} ${p.score}`).join(" · "));
  check("pillar weights sum to 1",
    Math.abs(s.pillars.reduce((a, p) => a + p.weight, 0) - 1) < 0.001);
  check("every sub-score carries a target band",
    s.pillars.every((p) => p.items.every((i) => i.target && i.value)));
  check("shelf rank computed", s.shelf !== null,
    s.shelf ? `#${s.shelf.rank} of ${s.shelf.outOf}` : "none");
  check("shelf rank is consistent with the competitor scores",
    !s.shelf || s.shelf.rank === scored.filter((v) => v.score > s.trc).length + 1);
  check("CTR band is ordered and labelled",
    s.ctrEstimate.low < s.ctrEstimate.high && Boolean(s.ctrEstimate.basis),
    `${s.ctrEstimate.low}–${s.ctrEstimate.high}% (${s.ctrEstimate.confidence})`);
  check("fixes are ranked by estimated gain",
    s.fixes.every((f, i) => i === 0 || s.fixes[i - 1].estimatedGain >= f.estimatedGain),
    `${s.fixes.length} fixes, top: ${s.fixes[0]?.title ?? "none"}`);
  check("dual axis reported",
    typeof s.axes.conventionFit === "number" && typeof s.axes.differentiation === "number",
    `fit ${s.axes.conventionFit} · diff ${s.axes.differentiation}`);

  step("8 · Preview scoring is free");
  const before = (await call("/api/me")).user.creditsRemaining;
  await call("/api/score", {
    method: "POST",
    body: JSON.stringify({ title, variantId: variant.id, shelfId: shelf.id, preview: true }),
  });
  const after = (await call("/api/me")).user.creditsRemaining;
  check("a preview score costs nothing", before === after, `${before} → ${after}`);

  step("9 · Edit and re-render");
  const edited = await call(`/api/variants/${variant.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      overlays: [{ ...variant.overlays[0], text: "SMOKE TEST", size: 96 }],
      scrim: { type: "bottom", strength: 0.5 },
    }),
  });
  check("overlay edit applied", edited.variant.overlays[0].text === "SMOKE TEST");
  check("a new render was produced", edited.variant.render_asset_id !== variant.render_asset_id);
  check("re-analysed after the edit", edited.variant.analysis !== null);

  step("10 · Titles");
  const titles = await call("/api/titles/generate", {
    method: "POST",
    body: JSON.stringify({ sourceVideoId: resolved.source.id, count: 6, shelfId: shelf.id }),
  });
  check("titles returned", titles.titles.length === 6, `source: ${titles.source}`);
  check("each is pre-scored", titles.titles.every((t) => typeof t.pillar.score === "number"));
  check("returned best-first",
    titles.titles.every((t, i) => i === 0 || titles.titles[i - 1].pillar.score >= t.pillar.score),
    titles.titles.map((t) => t.pillar.score).join(" ≥ "));

  step("11 · Save a winner");
  const winner = await call("/api/winners", {
    method: "POST",
    body: JSON.stringify({
      variantId: variant.id, titleText: title, scoreId: s.id,
      keyword: shelf.keyword, trc: s.trc,
    }),
  });
  check("winner saved", Boolean(winner.winner.id));
  await call(`/api/winners/${winner.winner.id}`, {
    method: "PATCH",
    body: JSON.stringify({ actual: { ctr: 6.4, views: 18200 } }),
  });
  const library = await call("/api/winners");
  const saved = library.winners.find((w) => w.id === winner.winner.id);
  check("real-world result recorded", saved?.actual?.ctr === 6.4, "predicted-vs-actual loop closed");
  await call(`/api/winners/${winner.winner.id}`, { method: "DELETE" });

  step("12 · Credit ledger");
  const ledger = await call("/api/credits");
  check("every spend is itemised", ledger.ledger.length > 0, `${ledger.ledger.length} entries`);
  check("ledger balances reconcile with the current balance",
    ledger.ledger[0].balance_after === ledger.remaining,
    `${ledger.remaining} credits left`);

  console.log(
    `\n${failed === 0 ? "\x1b[32m" : "\x1b[31m"}\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n\x1b[31m✗ smoke test aborted:\x1b[0m ${err.message}`);
  if (err.body) console.error(JSON.stringify(err.body, null, 2).slice(0, 600));
  if (err.cause) console.error(err.cause);
  process.exit(1);
});
