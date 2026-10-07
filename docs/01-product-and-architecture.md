# TubeRadar Thumbnails — product definition & architecture

> Workstream 1 deliverable: what we are building, why it beats the incumbent,
> how it is structured, and how it lands inside the existing TubeRadar SaaS.

---

## 1. The problem with every tool in this category

ThumbnailCreator and its peers answer the wrong question. They ask **"is this a
good thumbnail?"** and score it against a general rubric — contrast, faces,
text size, "does it pop".

That question has no answer. A finance thumbnail that aces a generic rubric
dies in a cooking shelf. A clean, minimal design that would win a design award
is invisible next to ten saturated faces. The only question that pays is:

> **Will this specific thumbnail + title pair beat the eleven cells it will
> physically sit next to, at the size it will actually be seen?**

Three things follow from taking that question seriously, and they are the
product:

1. **Score the pair, not the image.** A viewer reads the thumbnail and title in
   one glance. Scoring them separately misses the two failure modes that only
   exist in combination — the thumbnail repeating the title word for word
   (half the cell wasted) and the thumbnail promising something the title never
   delivers (click converts, session does not).

2. **Score at 168×94.** The click is decided in a mobile search shelf cell, not
   on a 27-inch monitor. We downscale and re-measure, and weight that sub-score
   highest.

3. **Score against the real shelf.** We fetch the videos currently ranking for
   the target keyword, run the identical analysis over their thumbnails, build
   a niche fingerprint, and rank the candidate inside that set.

### The dual axis — our core IP

Two forces decide a click and they pull against each other:

| Force | What it means | What happens if you ignore it |
|---|---|---|
| **Pattern match** | Match the shelf's *structure* — face or no face, text or no text, tonal register | Reads as off-topic, gets skipped |
| **Pattern interrupt** | Break from the shelf's *surface* — colour, framing, wording | Invisible next to near-identical neighbours |

Every competitor optimises one and calls it a strategy. We measure both,
plot them, and tell the user which one they are failing. "Nearly the same
palette as rank 4 — side by side, one of you disappears, and it will not be
the one with more subscribers" is advice no generic rubric can produce.

### Scorecard against ThumbnailCreator

| Capability | ThumbnailCreator | TubeRadar Thumbnails |
|---|---|---|
| Generate thumbnails from a prompt | ✅ | ✅ |
| Generate from a YouTube URL (with transcript grounding) | ✗ | ✅ |
| Score a thumbnail | Generic rubric | 24 measured signals, each with a target band |
| Score the **title + thumbnail pair** | ✗ | ✅ — a weighted pillar of its own |
| Score at mobile shelf size (168×94) | ✗ | ✅ — the highest-weighted sub-score |
| Compare against **live ranking competitors** | Limited | ✅ — fetched, analysed, scored identically |
| Simulated shelf rank ("#3 of 11") | ✗ | ✅ |
| Niche fingerprint (face rate, text rate, colour ownership) | ✗ | ✅ |
| Nearest-neighbour "you look like rank 4" warning | ✗ | ✅ |
| Fixes with the points each is worth | ✗ | ✅ |
| WYSIWYG editor that matches the export byte-for-byte | ✗ | ✅ — one shared draw module |
| Predicted vs actual CTR tracking | ✗ | ✅ |
| Works with zero API keys | ✗ | ✅ |

---

## 2. Core features

### Must-have (shipped)
- **Source resolution** — YouTube URL → metadata, existing thumbnail, baseline
  analysis, best-effort transcript. Or a bare topic prompt.
- **Competitor shelf** — top-N ranking videos for a keyword, each thumbnail
  downloaded, analysed and scored.
- **Concepting** — Claude designs N distinct concepts, each naming the specific
  shelf gap it exploits.
- **Image generation** — Gemini image model at 1280×720, with a deterministic
  local art-direction engine as the no-key fallback.
- **Overlay rendering** — server-side composite, bundled fonts, auto-fit text.
- **WYSIWYG editor** — drag to position, live shelf-size preview, same draw
  code as the server renderer.
- **Title lab** — 10 variants across hook archetypes, pre-scored and ranked.
- **Pair scorer** — the TRC index, four pillars, shelf rank, modelled CTR band,
  ranked fixes, optional Claude visual critique.
- **Winners library** — save a pairing, record the real CTR afterwards.
- **Credits + upgrade tier** — metered, ledgered, Stripe-ready.

### Deliberately deferred
Multi-user team workspaces, white-label PDF export, A/B swap scheduling against
the YouTube API, model calibration from recorded actuals. The data model already
carries the columns these need (`trt_saved_winners.actual`, `brand`,
`engine_version`), so none of them is a rewrite.

---

## 3. System architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Next.js 16 App Router  ·  React 19  ·  Tailwind v4                  │
│                                                                       │
│  /            overview        /score        pair scorer               │
│  /studio      generator       /competitors  shelf grid                │
│  /winners     library         /upgrade      plan & credits            │
└───────────────────────────────┬─────────────────────────────────────┘
                                │  fetch (JSON / FormData)
┌───────────────────────────────▼─────────────────────────────────────┐
│  Route handlers (node runtime)                                       │
│  auth → credit check → service → credit spend → response             │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────┐
│  Services        source · shelf · generate · score                   │
├─────────────────────────────────────────────────────────────────────┤
│  Scoring engine  image · title · pair · niche · bands  (pure, local) │
│  Imaging         analyze · draw · compose · synth · presets · fonts  │
│  Providers       youtube · gemini · claude · storage                 │
│  Data            Store interface → LocalStore | SupabaseStore        │
└─────────────────────────────────────────────────────────────────────┘
```

### Three architectural decisions worth defending

**1. The scoring engine is pure and local.**
No model call, no network, deterministic. Same inputs always produce the same
number. This is not a cost optimisation — it is what makes shelf ranking
*meaningful*. If the candidate and the competitors were scored by an LLM, the
comparison would be noise. Claude's critique layers *on top* as commentary and
is never load-bearing.

**2. One draw module, two runtimes.**
`lib/imaging/draw.ts` is typed against a structural `Ctx2D` interface that both
the browser's `CanvasRenderingContext2D` and `@napi-rs/canvas`'s `SKRSContext2D`
satisfy. The editor preview and the server export run the *same* code. The usual
failure in this category is an editor that drifts from the exported PNG; here it
is impossible by construction.

**3. Every provider has a local fallback.**
No key is required for anything. Missing Gemini → procedural art direction.
Missing Claude → rule-based concepts and titles. Missing YouTube Data API →
modelled shelf, clearly labelled as modelled everywhere it surfaces. Missing
Supabase → JSON store. A key that stops working degrades output quality; it
never breaks the product.

---

## 4. Data model

Ten tables, all prefixed `trt_`, all keyed to `auth.users.id`.

| Table | Holds | Notable |
|---|---|---|
| `trt_users` | plan, credit balance, period | 1:1 with `auth.users`, auto-provisioned by trigger |
| `trt_credit_ledger` | every spend and refund | append-only; balances are explainable |
| `trt_channels` | channel + brand kit | `brand` jsonb drives overlay defaults |
| `trt_source_videos` | URL/prompt, metadata, transcript | `baseline_analysis` = the score to beat |
| `trt_competitor_shelves` | the shelf + fingerprint | each competitor carries its own analysis + score |
| `trt_assets` | stored image bytes | tenant-scoped; immutable ids |
| `trt_thumbnail_variants` | concept, base + render, overlays | `overlays` jsonb is the editable layer |
| `trt_title_variants` | text, archetype, rationale | |
| `trt_pair_scores` | TRC, pillars, fixes, shelf, CTR band | `engine_version` pinned per row |
| `trt_saved_winners` | the keep decision | `actual` closes the predicted-vs-real loop |

Full DDL with RLS: `supabase/migrations/0001_tuberadar_thumbnails.sql`.

---

## 5. Integration with the existing TubeRadar SaaS

**Auth.** `getSessionUser()` reads the existing Supabase session cookie via
`@supabase/ssr`. A user already signed in to TubeRadar is signed in here. No
second login, no second user table — `trt_users.id` *is* `auth.users.id`.

**Schema.** The migration applies into the same project. The `trt_` prefix
guarantees no collision with core TubeRadar tables.

**Billing.** The module is an upgrade tier on the existing Stripe customer.
`POST /api/billing/checkout` passes `client_reference_id` and
`metadata.tuberadar_user_id` so the existing webhook can map the subscription
back without a new customer record. Without Stripe keys the tier switches
locally so the gated surface stays testable.

**Deployment.** Standard Next.js on Railway — same target as the main app.
`sharp` and `@napi-rs/canvas` are declared as server-external packages; both
ship prebuilt linux-x64 binaries.

**Routes.** Everything lives under `/studio`, `/score`, `/competitors`,
`/winners`, `/upgrade` and `/api/*`. Mounting under a `/thumbnails` basePath in
the host app is a config change, not a refactor.

---

## 6. Workstream split

| Workstream | Owns | Files |
|---|---|---|
| 1 · Product & architecture | this document, data model, API shape, migration | `docs/`, `supabase/` |
| 2 · Backend | providers, scoring engine, imaging, services, routes | `src/lib/`, `src/app/api/` |
| 3 · Frontend | pages, editor, score visuals, design system | `src/app/*/`, `src/components/` |
| 4 · Integration | auth, store adapters, credits, smoke test, runbook | `src/lib/auth.ts`, `db/`, `credits.ts`, `scripts/` |
