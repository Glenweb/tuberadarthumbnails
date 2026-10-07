# API reference

All routes run on the Node runtime, return JSON, and resolve the acting user
from the Supabase session cookie (or the local dev identity).

**Errors** are uniform:

```json
{ "error": "human-readable sentence", "code": "machine_code", "detail": { } }
```

| Code | Status | Meaning |
|---|---|---|
| `invalid_request` | 422 | Body failed schema validation; `detail` carries the Zod issues |
| `not_found` | 404 | Record missing, or owned by another tenant |
| `insufficient_credits` | 402 | `detail` has `required`, `remaining`, `action` |
| `plan_limit` | 402 | Plan cap reached (e.g. saved winners) |
| `file_too_large` / `unsupported_media_type` | 413 / 415 | Upload rejected |
| `stripe_error` / `billing_not_configured` | 502 / 501 | Billing path |
| `internal_error` | 500 | Unhandled |

---

## Status

### `GET /api/health`
No auth. Reports mode, engine version, live capabilities, and which env keys
would unlock what. Use it as the deployment smoke check.

### `GET /api/me`
User, plan, limits, credit balance, capabilities, counts, recent ledger.

### `GET /api/credits`
Balance, allowance, period start, full ledger (100 entries).

---

## Pipeline

### `POST /api/source/resolve` — 1 credit
```json
{ "url": "https://youtu.be/…", "prompt": "…", "keyword": "…", "withTranscript": true }
```
One of `url` or `prompt` is required. With a URL: metadata (Data API, else
oEmbed — no key needed), the existing thumbnail downloaded and analysed as a
**baseline**, and a best-effort transcript.

Returns `{ source, baseline, warnings[], creditsRemaining }`. Unreachable
YouTube is a `warning`, not an error — the pipeline continues.

### `POST /api/shelf` — 3 credits (cached shelves are free)
```json
{ "keyword": "aws cost optimisation", "depth": 12, "region": "GB", "refresh": false }
```
Fetches the top-N ranking videos, downloads and analyses each thumbnail, builds
the niche fingerprint, and scores every competitor with the identical engine.
Cached 6 hours per (user, keyword, region).

Returns `{ shelf, cached, note, depthLimit, imagesFetched, imagesStandIn, creditsRemaining }`.
`note` is populated when the shelf is **modelled** rather than live.

### `GET /api/shelf?id=…` or `?keyword=…`
Fetch a stored shelf without spending credits.

### `POST /api/concepts` — 2 credits
Claude designs N concepts against the shelf, each naming the gap it exploits.
Falls back to rule-based concepts with no key. Cheap on purpose: iterate on
direction before spending on renders.

### `POST /api/variants/generate` — 6 credits per variant
```json
{ "sourceVideoId": "…", "shelfId": "…", "count": 4,
  "style": "impact|plate|kicker|outline|editorial",
  "notes": "…", "concepts": [ … ], "reference": { "base64": "…", "mime": "image/png" } }
```
Concept → image → measured auto-fit overlays → 1280×720 composite → analysis.
Variants render in parallel; **one failing never fails the run** and its credits
are refunded automatically.

### `POST /api/variants/upload` — free
`multipart/form-data` with `file`. Normalises to 1280×720, analyses, stores as a
variant. Needs no API keys at all — the fastest path to value in the product.

### `GET /api/variants?runId=&sourceVideoId=&limit=`
### `GET|PATCH|DELETE /api/variants/{id}` — PATCH 1 credit
PATCH takes `{ overlays[], scrim, label }`, re-renders server-side and replaces
the render asset. The superseded render is deleted so edits do not accumulate
dead PNGs.

### `POST /api/titles/generate` — 2 credits
10 variants across hook archetypes, each returned **pre-scored by the same title
pillar the full scorer uses** — so this ranking and the scorer can never
disagree.

### `POST /api/score` — 1 credit (3 with `withAi`), previews free
```json
{ "title": "…", "variantId": "…", "keyword": "…", "shelfId": "…",
  "withAi": false, "preview": false }
```
The core endpoint. Returns `{ score, aiSource, shelfKeyword, shelfSource, creditsRemaining }`
where `score` carries `trc`, `grade`, `pillars[]`, `fixes[]`, `shelf`,
`ctrEstimate`, `axes`, `critique`.

`preview: true` skips persistence **and the charge** — the live editor scores on
every keystroke, and charging for that would make the most useful feature in the
product the one people avoid.

`withAi: true` adds Claude's visual critique: it sees the rendered thumbnail
*and up to three real competitor thumbnails*, with the measured signals handed
over as ground truth so it comments rather than re-estimates.

### `GET /api/score?limit=`

---

## Library & billing

### `GET|POST /api/winners`, `PATCH|DELETE /api/winners/{id}`
POST saves a pairing. PATCH records the real-world result:
`{ "actual": { "ctr": 6.4, "views": 18200 } }` — the predicted-vs-actual loop.

### `GET /api/assets/{id}`
Serves stored image bytes. Tenant-scoped: another user's asset returns 404, not
403, so ids cannot be probed. Immutable caching — a re-render mints a new id.

### `POST /api/billing/checkout`
`{ "plan": "creator|studio|agency" }`. With Stripe configured, returns
`{ mode: "stripe", checkoutUrl }` carrying `client_reference_id` and
`metadata.tuberadar_user_id` for the existing webhook. Without it, applies the
plan locally so the gated surface stays testable.

---

## Credit costs

| Action | Cost |
|---|---|
| `source_video` | 1 |
| `competitor_shelf` | 3 |
| `concepts` | 2 |
| `image_variant` | 6 (each) |
| `render` | 1 |
| `titles` | 2 |
| `score` | 1 |
| `score_ai` | 3 |

Metering is published in `/api/health` and `/api/me`, not hidden. Scoring is
priced low deliberately — it is the thing users should be doing constantly.
