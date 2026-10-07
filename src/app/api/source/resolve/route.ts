import * as z from "zod";
import { getSessionUser } from "@/lib/auth";
import { spend } from "@/lib/credits";
import { resolveSource } from "@/lib/services/source";
import { assetUrl } from "@/lib/providers/storage";
import { handleError, ok, parseBody } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z
  .object({
    url: z.string().trim().max(500).optional(),
    prompt: z.string().trim().max(2000).optional(),
    keyword: z.string().trim().max(200).optional(),
    channelId: z.string().optional(),
    withTranscript: z.boolean().optional(),
  })
  .refine((b) => Boolean(b.url?.trim() || b.prompt?.trim()), {
    message: "Provide a YouTube URL or a topic prompt.",
  });

/** Step 1 of the studio flow: URL or prompt in, analysed source video out. */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req, Body);
    const user = await getSessionUser();
    const charged = await spend(user, "source_video", { note: body.url ?? body.prompt ?? "" });

    const { source, warnings } = await resolveSource({
      user: charged,
      url: body.url ?? null,
      prompt: body.prompt ?? null,
      keyword: body.keyword ?? null,
      channelId: body.channelId ?? null,
      withTranscript: body.withTranscript,
    });

    return ok({
      source: {
        ...source,
        // Transcripts are long; the client only needs to know one exists.
        transcript: null,
        transcriptLength: source.transcript?.length ?? 0,
        thumbnailAssetUrl: assetUrl(source.thumbnail_asset_id),
      },
      baseline: source.baseline_analysis,
      warnings,
      creditsRemaining: charged.credits_remaining,
    });
  } catch (err) {
    return handleError(err);
  }
}
