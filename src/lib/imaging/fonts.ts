/**
 * Font registry shared by the server renderer and the browser editor.
 *
 * Fonts are bundled under /public/fonts so a server-side composite is
 * byte-identical on a laptop and on Railway, and so the live canvas editor in
 * the browser uses exactly the same faces the final render will use. That is
 * what makes the editor truly WYSIWYG — the usual failure mode in thumbnail
 * tools is an editor preview that drifts from the exported PNG.
 */
export type FontSpec = {
  /** Family name used in canvas `ctx.font` and CSS. */
  id: string;
  label: string;
  file: string;
  weight: number;
  /** Rough advance-width factor, used for auto-fit first guesses. */
  tracking: "tight" | "normal";
  /** Editorial note shown in the UI picker. */
  note: string;
};

export const FONTS: FontSpec[] = [
  {
    id: "TRDisplayBlack",
    label: "Impact Display",
    file: "InterDisplay-Black.otf",
    weight: 900,
    tracking: "tight",
    note: "Maximum shelf punch. Default for 2–4 word hooks.",
  },
  {
    id: "TRDisplayXBold",
    label: "Display Bold",
    file: "InterDisplay-ExtraBold.otf",
    weight: 800,
    tracking: "tight",
    note: "Slightly calmer than Impact. Good for 4–6 words.",
  },
  {
    id: "TRGrotesk",
    label: "Clean Grotesk",
    file: "Inter-Bold.otf",
    weight: 700,
    tracking: "normal",
    note: "Tech, finance and documentary niches.",
  },
  {
    id: "TRGroteskMed",
    label: "Grotesk Medium",
    file: "Inter-SemiBold.otf",
    weight: 600,
    tracking: "normal",
    note: "Sub-labels, kickers and credit lines.",
  },
  {
    id: "TRClassic",
    label: "Classic Sans",
    file: "LiberationSans-Bold.ttf",
    weight: 700,
    tracking: "normal",
    note: "Arial-metric. The familiar YouTube look.",
  },
  {
    id: "TRFriendly",
    label: "Friendly Sans",
    file: "Carlito-Bold.ttf",
    weight: 700,
    tracking: "normal",
    note: "Softer. Lifestyle, family and vlog niches.",
  },
  {
    id: "TRUniversal",
    label: "Universal",
    file: "DejaVuSans-Bold.ttf",
    weight: 700,
    tracking: "normal",
    note: "Widest character coverage — non-Latin scripts.",
  },
];

export const DEFAULT_FONT = FONTS[0].id;

export function fontById(id: string): FontSpec {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

/** CSS @font-face block for the browser editor. */
export function fontFaceCss(): string {
  return FONTS.map(
    (f) => `@font-face{font-family:'${f.id}';src:url('/fonts/${f.file}') format('${
      f.file.endsWith(".otf") ? "opentype" : "truetype"
    }');font-weight:${f.weight};font-display:block;}`,
  ).join("\n");
}
