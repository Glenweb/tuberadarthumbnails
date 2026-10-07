import { db } from "@/lib/db";
import type { CompetitorShelf, CompetitorVideo, TrtUser } from "@/lib/db/types";
import { analyzeImage } from "@/lib/imaging/analyze";
import { composeThumbnail, createMeasureContext } from "@/lib/imaging/compose";
import { buildOverlays } from "@/lib/imaging/presets";
import { synthesizeBase, ART_DIRECTIONS } from "@/lib/imaging/synth";
import { fetchCompetitorShelf, fetchImageBytes } from "@/lib/providers/youtube";
import { assetUrl, storeAsset } from "@/lib/providers/storage";
import { buildFingerprint, scoreCompetitors } from "@/lib/scoring";
import { newId, nowIso, seededRandom } from "@/lib/util/ids";

const SHELF_TTL_MS = 1000 * 60 * 60 * 6;

/** Palettes used when standing in for competitor thumbnails we cannot fetch. */
let sharedMeasureCtx: ReturnType<typeof createMeasureContext> | null = null;
/** One measuring context per process — font registration is the expensive part. */
function measureCtx() {
  sharedMeasureCtx ??= createMeasureContext();
  return sharedMeasureCtx;
}

const SHELF_PALETTES = [
  ["#101828", "#b42318", "#f97066", "#fef3f2"],
  ["#0b1324", "#1570ef", "#53b1fd", "#eff8ff"],
  ["#0d1a12", "#039855", "#6ce9a6", "#ecfdf3"],
  ["#1a1208", "#dc6803", "#fdb022", "#fffaeb"],
  ["#160d1f", "#9e77ed", "#d6bbfb", "#f9f5ff"],
  ["#101828", "#344054", "#98a2b3", "#f2f4f7"],
];

/**
 * Stand in for a competitor thumbnail we cannot download.
 *
 * Used for modelled shelves, and for live shelves where the image fetch fails
 * (region blocks, CDN hiccups). The stand-in is built to carry realistic visual
 * statistics — varied palettes, overlay text on most cells, varied clutter — so
 * the fingerprint it feeds is a plausible niche rather than noise.
 */
async function standInThumbnail(video: CompetitorVideo, seedSalt: string): Promise<Buffer> {
  const seed = `${seedSalt}:${video.youtube_id}:${video.rank}`;
  const rnd = seededRandom(seed);
  const palette = SHELF_PALETTES[Math.floor(rnd() * SHELF_PALETTES.length)];
  const direction = ART_DIRECTIONS[Math.floor(rnd() * ART_DIRECTIONS.length)].id;
  const { buffer } = await synthesizeBase({ seed, palette, direction });

  // ~70% of real thumbnails carry overlay copy; mirror that so faceRate and
  // textRate in the fingerprint stay in a realistic range.
  if (rnd() > 0.3) {
    const words = video.title
      .replace(/[^\w\s'£$%-]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 2 + Math.floor(rnd() * 2))
      .join(" ");
    return composeThumbnail({
      base: buffer,
      // Same measured auto-fit the real generator uses, so stand-ins never
      // render with copy running off the frame.
      overlays: buildOverlays({
        text: words || "WATCH THIS",
        style: rnd() > 0.75 ? "plate" : "impact",
        palette,
        font: rnd() > 0.5 ? "TRDisplayBlack" : "TRClassic",
        ctx: measureCtx(),
      }),
    });
  }
  return buffer;
}

export type BuildShelfOptions = {
  user: TrtUser;
  keyword: string;
  depth: number;
  region?: string;
  /** Reuse a recent shelf for the same keyword instead of re-fetching. */
  useCache?: boolean;
};

export type ShelfBuildResult = {
  shelf: CompetitorShelf;
  cached: boolean;
  /** Set when live data was unavailable and the shelf is modelled. */
  note: string | null;
  imagesFetched: number;
  imagesStandIn: number;
};

/**
 * Fetch, analyse, fingerprint and score a competitor shelf.
 *
 * Every competitor goes through the exact same analysis and scoring pipeline as
 * the user's own candidate. That symmetry is what makes "you would rank #3 of
 * 11" a real statement rather than a decorative badge.
 */
export async function buildShelf(opts: BuildShelfOptions): Promise<ShelfBuildResult> {
  const store = db();
  const keyword = opts.keyword.trim();
  const region = opts.region ?? "GB";

  if (opts.useCache !== false) {
    const recent = await store.find("shelves", {
      where: { user_id: opts.user.id, keyword, region },
      orderBy: "created_at",
      direction: "desc",
    });
    if (recent && Date.now() - new Date(recent.created_at).getTime() < SHELF_TTL_MS) {
      return {
        shelf: recent,
        cached: true,
        note: recent.source === "modelled"
          ? "Modelled shelf — add YOUTUBE_API_KEY for live competitor data."
          : null,
        imagesFetched: recent.videos.filter((v) => v.analysis).length,
        imagesStandIn: 0,
      };
    }
  }

  const { videos, source, note } = await fetchCompetitorShelf(keyword, opts.depth, region);

  let fetched = 0;
  let standIn = 0;
  const analysed: CompetitorVideo[] = [];
  // Bounded concurrency: enough to keep a 20-deep shelf fast, low enough not to
  // trip YouTube's CDN rate limiting.
  const CONCURRENCY = 5;
  for (let i = 0; i < videos.length; i += CONCURRENCY) {
    const chunk = videos.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (v) => {
        let bytes: Buffer | null = null;
        let url = v.thumbnail_url;

        if (!v.thumbnail_url.startsWith("synthetic:")) {
          bytes = await fetchImageBytes(v.thumbnail_url);
        }
        if (bytes) {
          fetched++;
        } else {
          bytes = await standInThumbnail(v, keyword);
          standIn++;
          // Persist the stand-in and point the row at it. Without this the
          // competitor grid and the shelf simulation render empty cells, which
          // reads as broken rather than as modelled — and the shelf view is
          // most of the value on a deployment with no YouTube key.
          try {
            const asset = await storeAsset({
              userId: opts.user.id,
              kind: "competitor",
              data: bytes,
            });
            url = assetUrl(asset.id) ?? v.thumbnail_url;
          } catch (err) {
            console.warn(`[shelf] could not store stand-in for ${v.youtube_id}:`, err);
          }
        }

        try {
          return { ...v, thumbnail_url: url, analysis: await analyzeImage(bytes) };
        } catch (err) {
          console.warn(`[shelf] analysis failed for ${v.youtube_id}:`, err);
          return { ...v, thumbnail_url: url };
        }
      }),
    );
    analysed.push(...results);
  }

  // Two passes: score every competitor against a provisional fingerprint, then
  // rebuild it so the median score reflects the shelf's real quality bar.
  const provisional = buildFingerprint(analysed);
  const scored = scoreCompetitors(analysed, provisional);
  const fingerprint = buildFingerprint(scored);

  const shelf: CompetitorShelf = {
    id: newId("shelf"),
    user_id: opts.user.id,
    keyword,
    region,
    source,
    videos: scored,
    fingerprint,
    created_at: nowIso(),
  };
  await store.insert("shelves", shelf);

  return {
    shelf,
    cached: false,
    note:
      note ??
      (standIn > 0 && source === "youtube_api"
        ? `${standIn} competitor thumbnail(s) could not be downloaded and were modelled instead.`
        : null),
    imagesFetched: fetched,
    imagesStandIn: standIn,
  };
}

export async function getShelf(id: string): Promise<CompetitorShelf | null> {
  return db().get("shelves", id);
}

/** Most recent shelf for a user, optionally filtered by keyword. */
export async function latestShelf(
  userId: string,
  keyword?: string | null,
): Promise<CompetitorShelf | null> {
  return db().find("shelves", {
    where: keyword ? { user_id: userId, keyword } : { user_id: userId },
    orderBy: "created_at",
    direction: "desc",
  });
}
