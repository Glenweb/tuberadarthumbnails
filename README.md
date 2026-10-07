# TubeRadar Thumbnails

**A thumbnail and title optimisation module for the TubeRadar SaaS.**

Generate thumbnails from a YouTube URL or a prompt, edit the overlays in a
WYSIWYG canvas, and score the title + thumbnail *pair* against the competitor
shelf it will actually appear in — at the 168×94 size that decides the click.

```bash
npm install && npm run dev
# → http://localhost:3000
```

No API keys required. Everything below works offline on first run.

---

## Why this is different

Every tool in this category scores an image against a general rubric. That
question has no answer — a finance thumbnail that aces a generic rubric dies in
a cooking shelf. The question that pays is:

> Will this **pair** beat the eleven cells it will physically sit next to, at
> the size it will actually be seen?

Three consequences, and they are the product:

**1 · Score the pair, not the image.** The viewer reads thumbnail and title in
one glance. Scoring them apart misses the two failures that only exist together:
the thumbnail repeating the title word for word, and the thumbnail promising
what the title never delivers.

**2 · Score at 168×94.** We downscale to the real mobile search cell and
re-measure contrast and surviving detail. It is the highest-weighted sub-score
in the engine.

**3 · Score against the real shelf.** We fetch the videos currently ranking for
your keyword, run the **identical** analysis over their thumbnails, and rank you
inside that set. *"You would rank #3 of 11"* is a real statement because both
sides were measured the same way.

### The dual axis

Two forces decide a click and they pull against each other. **Pattern match** —
break the niche's conventions and you read as off-topic. **Pattern interrupt** —
look like your neighbours and you are invisible. Competitors optimise one and
call it a strategy. We measure both, plot them, and tell you which one you are
failing:

> *"Nearly the same palette as 'The honest truth about…' at rank 4. Side by side,
> one of you disappears — and it will not be the one with more subscribers."*

---

## What it does

| | |
|---|---|
| **Studio** | URL or prompt → shelf analysis → concepts → variants → edit → score, in one pass |
| **Scorer** | Upload a finished thumbnail, paste the title, get the shelf position before you publish |
| **Shelf** | Face rate, text rate, colour ownership, overused phrasing and the quality bar for any keyword |
| **Winners** | Saved pairings, with real CTR recorded afterwards to calibrate the model |
| **Plan** | Credits, published metering, Stripe-ready upgrade tiers |

**The editor is genuinely WYSIWYG.** `lib/imaging/draw.ts` is typed against a
structural interface that both the browser canvas and `@napi-rs/canvas` satisfy,
so the preview and the server export run the *same code*. Editor drift is
impossible by construction.

---

## It degrades, it never breaks

Every provider has a deterministic local fallback. Add keys one at a time; each
upgrades a part of the pipeline independently.

| Key | Turns on | Without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude concepts, titles, visual critique | Rule-based concepts and titles |
| `GEMINI_API_KEY` | Photoreal generation | Six procedural art directions |
| `YOUTUBE_API_KEY` | Live shelves and stats | Modelled shelf, labelled everywhere |
| `SUPABASE_*` | Shared Postgres + TubeRadar auth | Local JSON store |
| `STRIPE_SECRET_KEY` | Real checkout | Local plan switching |

`GET /api/health` always reports exactly what is live.

---

## Scoring, in one table

| Pillar | Weight | Measures |
|---|---|---|
| Thumbnail craft | 35% | Shelf legibility @168×94, focal clarity, contrast, colour, composition, text load, human presence |
| Title craft | 25% | Hook devices, specificity, mobile truncation, keyword placement, distinctiveness, trust, readability |
| Pair coherence | 15% | Word redundancy, promise alignment, combined load, overlay discipline |
| Niche fit | 25% | Convention fit, differentiation vs nearest neighbour, the shelf's quality bar |

24 measured signals, each surfaced with its value and target band. The engine is
pure and local — no model call — which is precisely what makes comparing you to
your competitors meaningful. Claude's critique layers on top as commentary and
is never load-bearing.

Full method, including known limitations: [`docs/02-scoring-model.md`](docs/02-scoring-model.md).

---

## Integration with TubeRadar

`trt_users.id` **is** `auth.users.id`. A user signed in to TubeRadar is signed
in here — no second login, no second user table. Apply
`supabase/migrations/0001_tuberadar_thumbnails.sql` into the existing project;
every table is `trt_`-prefixed and RLS-scoped. Billing attaches to the existing
Stripe customer via `client_reference_id`.

---

## Docs

| | |
|---|---|
| [`docs/01-product-and-architecture.md`](docs/01-product-and-architecture.md) | Product definition, competitive scorecard, architecture, data model |
| [`docs/02-scoring-model.md`](docs/02-scoring-model.md) | The TRC engine in full, with its limitations stated |
| [`docs/03-api-reference.md`](docs/03-api-reference.md) | Every endpoint, cost and error code |
| [`docs/04-runbook.md`](docs/04-runbook.md) | Local run, deploy, network requirements, troubleshooting |

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind v4 · `sharp` · `@napi-rs/canvas` ·
Supabase · Anthropic SDK · Gemini · YouTube Data API v3 · Stripe

```bash
npm run dev        # localhost:3000
npm run verify     # typecheck + production build
npm run smoke      # exercise the full pipeline against a running server
```
