# Runbook

## Run it locally

```bash
npm install
npm run dev
# → http://localhost:3000
```

**No environment file is required.** With no keys the module runs in
*Local Studio* mode: procedural art direction, rule-based concepts and titles,
modelled competitor shelves, a JSON store under `.data/`, and the **full**
deterministic scoring engine. Every screen works end to end.

Verify:
```bash
npm run smoke        # exercises the whole pipeline against a running server
curl localhost:3000/api/health | jq .mode
```

## Switch providers live

Copy `.env.example` to `.env.local` and add keys one at a time — each one
independently upgrades a part of the pipeline.

| Key | Turns on | Without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude concepts, titles, visual critique | Rule-based concepts and titles; deterministic score only |
| `GEMINI_API_KEY` | Photoreal 1280×720 generation | Six procedural art directions |
| `YOUTUBE_API_KEY` | Live shelves, view counts, channel size | Modelled shelf, labelled as such everywhere |
| `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Shared Postgres + Storage + TubeRadar auth | Local JSON store, demo identity |
| `STRIPE_SECRET_KEY` + price ids | Real checkout | Local plan switching |

`/api/health` always reports exactly what is live.

## Deploy into TubeRadar

1. **Schema** — apply `supabase/migrations/0001_tuberadar_thumbnails.sql` to the
   existing TubeRadar Supabase project. It creates the `trt_*` tables, RLS
   policies, the storage bucket, an auto-provision trigger on `auth.users`, and
   backfills existing users.
2. **Env** — set the Supabase URL, anon key and service role key. Auth then
   flows from the existing TubeRadar session cookie; no second login.
3. **Billing** — create three Stripe prices, set
   `STRIPE_PRICE_THUMBS_{CREATOR,STUDIO,AGENCY}`. Checkout sends
   `client_reference_id` and `metadata.tuberadar_user_id` so the existing
   webhook can map the subscription with no new customer record.
4. **Railway** — `npm run build && npm start`. `sharp` and `@napi-rs/canvas` are
   declared as server-external packages and ship prebuilt linux-x64 binaries;
   no native build step. Fonts are bundled in `public/fonts`, so a server render
   is byte-identical on a laptop and in production.
5. **Mounting** — to serve under `/thumbnails`, set `basePath` in
   `next.config.ts`. No code changes.

## Network requirements

Outbound HTTPS to:

| Host | For |
|---|---|
| `www.googleapis.com` | YouTube Data API v3 |
| `i.ytimg.com`, `www.youtube.com` | Thumbnail downloads, oEmbed |
| `generativelanguage.googleapis.com` | Gemini image generation |
| `api.anthropic.com` | Claude |
| `api.stripe.com` | Checkout |

If a host is blocked the module degrades rather than failing — a blocked
`i.ytimg.com` means competitor thumbnails are modelled and the UI says so.

## Operations

- **Credits** reset on a 30-day rolling period, checked lazily on each
  `getSessionUser()`. Every spend and refund is in `trt_credit_ledger`.
- **Storage growth** — re-renders delete the superseded asset. Generated bases
  persist; a periodic sweep of `trt_assets` with no referencing variant is the
  obvious cleanup job.
- **Engine versioning** — `trt_pair_scores.engine_version` is pinned per row.
  Never re-score historical rows under new weights; they stop being comparable.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Could not download the existing thumbnail" | `i.ytimg.com` blocked | Allow the host; scoring still works via upload |
| Shelf says "modelled" | No `YOUTUBE_API_KEY` | Add the key, then **Refresh** on the shelf page |
| Concepts look generic | No `ANTHROPIC_API_KEY` | Add it; heuristic concepts are the fallback |
| Variants look graphic, not photoreal | No `GEMINI_API_KEY` | Add it; local art direction is the fallback |
| Editor text ≠ exported PNG | Fonts failed to register | Check `public/fonts` shipped; `/api/health` → `rendering` |
