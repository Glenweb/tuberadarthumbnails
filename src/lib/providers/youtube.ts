import { config } from "@/lib/config";
import type { CompetitorVideo } from "@/lib/db/types";
import { seededRandom } from "@/lib/util/ids";
import { TITLE_ARCHETYPES } from "@/lib/scoring/lexicon";

const API = "https://www.googleapis.com/youtube/v3";
const TIMEOUT_MS = 12_000;

export type VideoMeta = {
  youtubeId: string;
  title: string;
  description: string;
  channelTitle: string;
  channelId: string | null;
  thumbnailUrl: string;
  publishedAt: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  durationSeconds: number | null;
  tags: string[];
  source: "youtube_api" | "oembed";
};

/** Accepts watch URLs, youtu.be, shorts, embed URLs, or a bare 11-char id. */
export function parseVideoId(input: string): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  if (/^[\w-]{11}$/.test(s)) return s;
  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/shorts\/)([\w-]{11})/,
    /(?:youtube\.com\/embed\/)([\w-]{11})/,
    /(?:youtube\.com\/live\/)([\w-]{11})/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 220)}` : ""}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** ISO 8601 duration (PT4M13S) → seconds. */
function parseDuration(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const [, d, h, min, s] = m;
  return (
    (Number(d ?? 0) * 86400) + (Number(h ?? 0) * 3600) + (Number(min ?? 0) * 60) + Number(s ?? 0)
  );
}

export function thumbnailUrlFor(id: string, quality: "max" | "hq" = "max"): string {
  return `https://i.ytimg.com/vi/${id}/${quality === "max" ? "maxresdefault" : "hqdefault"}.jpg`;
}

/**
 * Fetch a thumbnail image, stepping down through YouTube's resolution ladder.
 * maxres does not exist for every video, so a 404 there is normal, not an error.
 */
export async function fetchThumbnailBytes(id: string): Promise<Buffer | null> {
  for (const name of ["maxresdefault", "sddefault", "hqdefault", "mqdefault"]) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      const res = await fetch(`https://i.ytimg.com/vi/${id}/${name}.jpg`, { signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      // YouTube serves a 120x90 grey placeholder instead of a 404 for missing sizes.
      if (buf.length > 3000) return buf;
    } catch {
      // Network blocked or host unreachable — try the next size, then give up.
    }
  }
  return null;
}

/** Download an arbitrary thumbnail URL (used for competitor images). */
export async function fetchImageBytes(url: string): Promise<Buffer | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    const res = await fetch(url, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 1000 ? buf : null;
  } catch {
    return null;
  }
}

/**
 * Video metadata.
 *
 * With a Data API key we get stats, tags and duration. Without one, oEmbed
 * still returns title, channel and thumbnail with no key and no quota — which
 * is enough to drive concepting and scoring, so the URL flow never hard-requires
 * a Google Cloud project.
 */
export async function fetchVideoMeta(id: string): Promise<VideoMeta | null> {
  if (config.youtube.apiKey) {
    try {
      const data = (await fetchJson(
        `${API}/videos?part=snippet,statistics,contentDetails&id=${id}&key=${config.youtube.apiKey}`,
      )) as {
        items?: {
          snippet: {
            title: string; description: string; channelTitle: string; channelId: string;
            publishedAt: string; tags?: string[];
            thumbnails: Record<string, { url: string }>;
          };
          statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
          contentDetails?: { duration?: string };
        }[];
      };
      const item = data.items?.[0];
      if (item) {
        const t = item.snippet.thumbnails;
        return {
          youtubeId: id,
          title: item.snippet.title,
          description: item.snippet.description ?? "",
          channelTitle: item.snippet.channelTitle,
          channelId: item.snippet.channelId ?? null,
          thumbnailUrl: (t.maxres ?? t.standard ?? t.high ?? t.medium ?? t.default)?.url ?? thumbnailUrlFor(id),
          publishedAt: item.snippet.publishedAt ?? null,
          viewCount: item.statistics?.viewCount ? Number(item.statistics.viewCount) : null,
          likeCount: item.statistics?.likeCount ? Number(item.statistics.likeCount) : null,
          commentCount: item.statistics?.commentCount ? Number(item.statistics.commentCount) : null,
          durationSeconds: parseDuration(item.contentDetails?.duration),
          tags: item.snippet.tags ?? [],
          source: "youtube_api",
        };
      }
    } catch (err) {
      console.warn("[youtube] Data API lookup failed, falling back to oEmbed:", err);
    }
  }

  try {
    const data = (await fetchJson(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${id}`,
      )}&format=json`,
    )) as { title: string; author_name: string; thumbnail_url: string };
    return {
      youtubeId: id,
      title: data.title,
      description: "",
      channelTitle: data.author_name,
      channelId: null,
      thumbnailUrl: thumbnailUrlFor(id),
      publishedAt: null,
      viewCount: null, likeCount: null, commentCount: null, durationSeconds: null,
      tags: [],
      source: "oembed",
    };
  } catch (err) {
    console.warn("[youtube] oEmbed lookup failed:", err);
    return null;
  }
}

/**
 * Best-effort transcript via YouTube's own timedtext endpoint.
 *
 * There is no supported public API for this, so it is treated as a bonus: when
 * it works the concepts get grounded in what the video actually says, and when
 * it does not the rest of the pipeline is unaffected.
 */
export async function fetchTranscript(id: string): Promise<string | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    const res = await fetch(
      `https://video.google.com/timedtext?lang=en&v=${id}&fmt=json3`,
      { signal: ctl.signal },
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      events?: { segs?: { utf8?: string }[] }[];
    };
    const text = (json.events ?? [])
      .flatMap((e) => e.segs ?? [])
      .map((s) => s.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > 80 ? text.slice(0, 12000) : null;
  } catch {
    return null;
  }
}

/* ────────────────────────── Competitor shelf ────────────────────────────── */

export type ShelfResult = {
  videos: CompetitorVideo[];
  source: "youtube_api" | "modelled";
  note: string | null;
};

/**
 * The top-ranking videos for a keyword — the actual shelf the user's thumbnail
 * will appear in.
 */
export async function fetchCompetitorShelf(
  keyword: string,
  depth: number,
  region = "GB",
): Promise<ShelfResult> {
  if (config.youtube.apiKey) {
    try {
      const search = (await fetchJson(
        `${API}/search?part=snippet&type=video&maxResults=${Math.min(
          50, depth,
        )}&q=${encodeURIComponent(keyword)}&regionCode=${region}&relevanceLanguage=en&key=${config.youtube.apiKey}`,
      )) as {
        items?: { id: { videoId: string }; snippet: { title: string; channelTitle: string; channelId: string; publishedAt: string; thumbnails: Record<string, { url: string }> } }[];
      };
      const items = search.items ?? [];
      if (items.length > 0) {
        const ids = items.map((i) => i.id.videoId).join(",");
        const stats = (await fetchJson(
          `${API}/videos?part=statistics,snippet&id=${ids}&key=${config.youtube.apiKey}`,
        )) as {
          items?: { id: string; statistics?: { viewCount?: string }; snippet: { channelId: string; publishedAt: string } }[];
        };
        const statsById = new Map((stats.items ?? []).map((v) => [v.id, v]));

        // One extra call resolves channel size, which is what tells us whether a
        // rival is winning on thumbnail craft or on raw subscriber base.
        const channelIds = [...new Set(items.map((i) => i.snippet.channelId))].slice(0, 50);
        let subsById = new Map<string, number>();
        try {
          const chans = (await fetchJson(
            `${API}/channels?part=statistics&id=${channelIds.join(",")}&key=${config.youtube.apiKey}`,
          )) as { items?: { id: string; statistics?: { subscriberCount?: string } }[] };
          subsById = new Map(
            (chans.items ?? []).map((c) => [c.id, Number(c.statistics?.subscriberCount ?? 0)]),
          );
        } catch {
          // Channel stats are a nice-to-have; the shelf works without them.
        }

        const videos: CompetitorVideo[] = items.slice(0, depth).map((it, idx) => {
          const st = statsById.get(it.id.videoId);
          const published = st?.snippet.publishedAt ?? it.snippet.publishedAt;
          const views = st?.statistics?.viewCount ? Number(st.statistics.viewCount) : null;
          const ageDays = published
            ? Math.max(1, (Date.now() - new Date(published).getTime()) / 86_400_000)
            : null;
          const t = it.snippet.thumbnails;
          return {
            youtube_id: it.id.videoId,
            title: it.snippet.title,
            channel_title: it.snippet.channelTitle,
            channel_id: it.snippet.channelId ?? null,
            thumbnail_url: (t.maxres ?? t.high ?? t.medium ?? t.default)?.url ?? thumbnailUrlFor(it.id.videoId),
            view_count: views,
            subscriber_count: subsById.get(it.snippet.channelId) ?? null,
            published_at: published ?? null,
            rank: idx + 1,
            velocity: views && ageDays ? Math.round(views / ageDays) : null,
            analysis: null,
            score: null,
          };
        });
        return { videos, source: "youtube_api", note: null };
      }
    } catch (err) {
      console.warn("[youtube] competitor search failed, using modelled shelf:", err);
    }
  }

  return {
    videos: modelledShelf(keyword, depth),
    source: "modelled",
    note:
      "Modelled shelf — no live YouTube Data API key is configured, so these competitors are generated from the keyword rather than fetched. Scores are directionally useful; add YOUTUBE_API_KEY for the real result set.",
  };
}

/**
 * A deterministic stand-in shelf.
 *
 * Built from the keyword so the competitor grid, fingerprint, shelf ranking and
 * fix list all stay exercisable with no API key — and clearly labelled as
 * modelled everywhere it surfaces, so it can never be mistaken for live data.
 */
export function modelledShelf(keyword: string, depth: number): CompetitorVideo[] {
  const rnd = seededRandom(`shelf:${keyword.toLowerCase()}`);
  const kw = keyword.trim() || "your topic";
  const noun = kw.split(/\s+/).slice(-2).join(" ");
  const channels = [
    "Peak Signal", "The Practical Lab", "Hudson & Co", "Oversight", "Maple Row",
    "Field Notes", "Northline", "The Breakdown", "Clearcut", "Studio Ninety",
    "Trueline Media", "Harbour Street",
  ];
  const templates = [
    `The honest truth about ${noun}`,
    `I tested ${noun} for 30 days — here's what happened`,
    `${3 + Math.floor(rnd() * 7)} ${noun} mistakes that cost me money`,
    `Why nobody tells you this about ${noun}`,
    `${noun}: complete beginner's guide (${new Date().getFullYear()})`,
    `Stop doing ${noun} like this`,
    `${noun} vs the alternative — the real answer`,
    `How I fixed ${noun} in one weekend`,
    `Every ${noun} method, ranked worst to best`,
    `${noun} in ${5 + Math.floor(rnd() * 10)} minutes (no fluff)`,
    `The ${noun} setup that actually works`,
    `What ${1 + Math.floor(rnd() * 9)} years of ${noun} taught me`,
  ];

  const count = Math.min(depth, templates.length);
  return Array.from({ length: count }, (_, i) => {
    const views = Math.round(8000 + Math.pow(rnd(), 2.2) * 1_900_000);
    const ageDays = 14 + Math.floor(rnd() * 500);
    return {
      youtube_id: `modelled-${i + 1}`,
      title: templates[i],
      channel_title: channels[i % channels.length],
      channel_id: null,
      // Resolved to a synthesized image by the shelf builder.
      thumbnail_url: `synthetic:${encodeURIComponent(keyword)}:${i}`,
      view_count: views,
      subscriber_count: Math.round(2000 + Math.pow(rnd(), 2) * 1_400_000),
      published_at: new Date(Date.now() - ageDays * 86_400_000).toISOString(),
      rank: i + 1,
      velocity: Math.round(views / ageDays),
      analysis: null,
      score: null,
    };
  });
}

export const ARCHETYPES = TITLE_ARCHETYPES;
