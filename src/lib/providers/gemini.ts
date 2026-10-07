import { config } from "@/lib/config";
import { synthesizeBase, type ArtDirection } from "@/lib/imaging/synth";
import { normalizeTo1280x720 } from "@/lib/imaging/analyze";

/**
 * Google AI Studio (Gemini) image generation.
 *
 * Written defensively on purpose: image-model request shapes and model ids move
 * faster than anything else in this stack, so the adapter retries without the
 * optional image config on a 400, steps down to a fallback model on a 404, and
 * falls back to local synthesis if both fail. A key that stops working degrades
 * the output quality — it never breaks the generator.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 90_000;

export type GenerateImageOptions = {
  prompt: string;
  /** Seed for the deterministic local fallback. */
  seed: string;
  palette?: string[];
  direction?: ArtDirection;
  angle?: string;
  /** Optional reference image for image-to-image (brand assets, a real face). */
  reference?: { base64: string; mime: string } | null;
};

export type GenerateImageResult = {
  buffer: Buffer;
  source: "gemini" | "synthesized";
  model: string | null;
  note?: string;
};

type GeminiPart = {
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
  text?: string;
};

function extractImage(json: unknown): Buffer | null {
  const candidates = (json as { candidates?: { content?: { parts?: GeminiPart[] } }[] }).candidates;
  for (const c of candidates ?? []) {
    for (const part of c.content?.parts ?? []) {
      const data = part.inlineData?.data ?? part.inline_data?.data;
      if (data) return Buffer.from(data, "base64");
    }
  }
  return null;
}

async function requestImage(
  model: string,
  prompt: string,
  reference: GenerateImageOptions["reference"],
  withImageConfig: boolean,
): Promise<{ buffer: Buffer } | { status: number; message: string }> {
  const parts: Record<string, unknown>[] = [];
  if (reference) {
    parts.push({ inlineData: { mimeType: reference.mime, data: reference.base64 } });
  }
  parts.push({ text: prompt });

  const body: Record<string, unknown> = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      ...(withImageConfig
        ? { imageConfig: { aspectRatio: "16:9", imageSize: "2K" } }
        : {}),
    },
  };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": config.gemini.apiKey ?? "",
      },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { status: res.status, message: text.slice(0, 400) };
    }
    const json = await res.json();
    const buffer = extractImage(json);
    if (!buffer) {
      return { status: 200, message: "response contained no image part" };
    }
    return { buffer };
  } catch (err) {
    return {
      status: 0,
      message: err instanceof Error ? err.message.slice(0, 200) : "request failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function generateImage(opts: GenerateImageOptions): Promise<GenerateImageResult> {
  if (!config.gemini.apiKey) {
    const { buffer, direction } = await synthesizeBase({
      seed: opts.seed,
      palette: opts.palette,
      direction: opts.direction,
      angle: opts.angle,
    });
    return { buffer, source: "synthesized", model: null, note: `Local art direction: ${direction}` };
  }

  // Image models render text badly; overlay copy is composited separately.
  const prompt = `${opts.prompt}\n\nStrict requirements: 16:9 YouTube thumbnail composition, 1280x720 or larger. Photographic realism and high clarity. Do NOT render any text, words, letters, numbers, captions, watermarks or logos anywhere in the image — overlay copy is added separately. Leave one side of the frame visually clear for that copy. The main subject must remain readable when the image is scaled down to 168x94 pixels.`;

  const attempts: { model: string; withConfig: boolean }[] = [
    { model: config.gemini.model, withConfig: true },
    { model: config.gemini.model, withConfig: false },
    { model: config.gemini.fallbackModel, withConfig: true },
    { model: config.gemini.fallbackModel, withConfig: false },
  ];

  const failures: string[] = [];
  for (const attempt of attempts) {
    const result = await requestImage(attempt.model, prompt, opts.reference ?? null, attempt.withConfig);
    if ("buffer" in result) {
      try {
        return {
          buffer: await normalizeTo1280x720(result.buffer, "png"),
          source: "gemini",
          model: attempt.model,
        };
      } catch (err) {
        failures.push(`${attempt.model}: returned an image that could not be decoded (${String(err).slice(0, 80)})`);
        continue;
      }
    }
    failures.push(`${attempt.model}${attempt.withConfig ? "" : " (no imageConfig)"}: ${result.status} ${result.message}`);
    // A 401/403 is a key problem — no point walking the rest of the ladder.
    if (result.status === 401 || result.status === 403) break;
  }

  const { buffer, direction } = await synthesizeBase({
    seed: opts.seed,
    palette: opts.palette,
    direction: opts.direction,
    angle: opts.angle,
  });
  return {
    buffer,
    source: "synthesized",
    model: null,
    note: `Gemini unavailable, used local art direction "${direction}". ${failures[0] ?? ""}`.trim(),
  };
}
