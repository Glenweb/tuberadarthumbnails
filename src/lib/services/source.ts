import { db } from "@/lib/db";
import type { SourceVideo, TrtUser } from "@/lib/db/types";
import { analyzeImage, normalizeTo1280x720 } from "@/lib/imaging/analyze";
import { storeAsset } from "@/lib/providers/storage";
import {
  fetchThumbnailBytes,
  fetchTranscript,
  fetchVideoMeta,
  parseVideoId,
} from "@/lib/providers/youtube";
import { newId, nowIso } from "@/lib/util/ids";

export type ResolveResult = {
  source: SourceVideo;
  /** Non-fatal problems worth surfacing in the UI. */
  warnings: string[];
};

/**
 * Turn a YouTube URL — or a bare topic prompt — into a source video record.
 *
 * The URL path also analyses the *existing* thumbnail, which is what lets the
 * studio show the lift a new variant delivers rather than just a score in a
 * vacuum. "Your current thumbnail scores 54, this variant scores 81" is a far
 * more useful statement than either number alone.
 */
export async function resolveSource(args: {
  user: TrtUser;
  url?: string | null;
  prompt?: string | null;
  keyword?: string | null;
  channelId?: string | null;
  withTranscript?: boolean;
}): Promise<ResolveResult> {
  const store = db();
  const warnings: string[] = [];
  const videoId = args.url ? parseVideoId(args.url) : null;

  if (args.url && !videoId) {
    warnings.push("That did not look like a YouTube video URL — treating it as a topic prompt.");
  }

  let meta = null;
  let thumbnailAssetId: string | null = null;
  let baselineAnalysis = null;
  let transcript: string | null = null;
  let transcriptSource: SourceVideo["transcript_source"] = "none";

  if (videoId) {
    meta = await fetchVideoMeta(videoId);
    if (!meta) {
      warnings.push(
        "Could not reach YouTube for this video's metadata. Check the URL, or that outbound access to youtube.com is permitted from this host.",
      );
    }

    const bytes = await fetchThumbnailBytes(videoId);
    if (bytes) {
      try {
        const normalised = await normalizeTo1280x720(bytes, "jpeg");
        const asset = await storeAsset({
          userId: args.user.id,
          kind: "source",
          data: normalised,
          mime: "image/jpeg",
        });
        thumbnailAssetId = asset.id;
        baselineAnalysis = await analyzeImage(normalised);
      } catch (err) {
        warnings.push(`Current thumbnail could not be analysed: ${String(err).slice(0, 120)}`);
      }
    } else {
      warnings.push(
        "Could not download the existing thumbnail, so there is no baseline to compare against.",
      );
    }

    if (args.withTranscript !== false) {
      transcript = await fetchTranscript(videoId);
      if (transcript) transcriptSource = "timedtext";
    }
  }

  const topic = args.prompt?.trim() || meta?.title || args.url?.trim() || "Untitled";

  const source: SourceVideo = {
    id: newId("src"),
    user_id: args.user.id,
    channel_id: args.channelId ?? null,
    youtube_id: videoId,
    url: args.url?.trim() || null,
    title: meta?.title ?? (args.prompt?.trim() || null),
    description: meta?.description ?? (videoId ? null : args.prompt?.trim() ?? null),
    keyword: args.keyword?.trim() || deriveKeyword(topic),
    thumbnail_url: meta?.thumbnailUrl ?? null,
    thumbnail_asset_id: thumbnailAssetId,
    channel_title: meta?.channelTitle ?? null,
    view_count: meta?.viewCount ?? null,
    like_count: meta?.likeCount ?? null,
    comment_count: meta?.commentCount ?? null,
    duration_seconds: meta?.durationSeconds ?? null,
    published_at: meta?.publishedAt ?? null,
    tags: meta?.tags ?? null,
    transcript,
    transcript_source: transcriptSource,
    baseline_analysis: baselineAnalysis,
    created_at: nowIso(),
  };

  await store.insert("source_videos", source);
  return { source, warnings };
}

/** Best-effort search keyword from a title or prompt, when none was given. */
function deriveKeyword(topic: string): string {
  const cleaned = topic
    .replace(/[|•–—]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^\w\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const stop = new Set([
    "the", "a", "an", "how", "why", "what", "i", "my", "you", "your", "this",
    "that", "and", "for", "with", "in", "on", "to", "of", "is", "are", "it",
  ]);
  const words = cleaned.split(" ").filter((w) => w.length > 2 && !stop.has(w.toLowerCase()));
  return words.slice(0, 4).join(" ") || cleaned.slice(0, 40);
}
