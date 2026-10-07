# The TubeRadar Click Index (TRC)

Engine version `trc-1.2.0`. Deterministic, local, no model call.

Every sub-score ships to the UI with its **measured value** and its **target
band**, so a user can always audit why they got the number. Nothing here is a
black box, and nothing here is an LLM's opinion.

---

## Why bands, not "more is better"

Almost every thumbnail variable is non-monotonic. Saturation below the band
reads flat; above it reads cheap. Text coverage below the band wastes the
format; above it turns the cell into a wall of words at 168px. A monotonic
score would tell a user to keep pushing in one direction until the thumbnail
is unusable.

```
score = 100                       inside [lo, hi]
      = linear falloff → 0        outside, reaching 0 at hardLo / hardHi
```

Bands are *absolute* where the constraint comes from how the image is physically
displayed (shelf legibility, contrast), and *niche-adaptive* where it comes from
convention (text load, saturation, face expectation) — those widen or shift
using the shelf fingerprint.

---

## Pillar 1 — Thumbnail craft · 35%

| Sub-score | Weight | Measured from | Target |
|---|---|---|---|
| **Shelf legibility @168×94** | 26% | Image downscaled to the real mobile cell, then re-measured: RMS contrast + proportion of edge detail retained | 18–42% contrast, 25%+ detail |
| Focal clarity | 18% | Gini coefficient of Sobel edge energy over a 12×7 grid + overall edge density | 55%+ concentration, 6–26% edges |
| Contrast | 14% | RMS luminance contrast (Rec.709) | 19–40% |
| Colour punch | 14% | HSV saturation mean + Hasler–Süsstrunk colourfulness | niche-adaptive |
| Composition | 12% | Edge-energy centroid vs rule-of-thirds; face/text separation; duration-pill collision | subject on a third, copy opposite |
| Text load | 10% | Share of 16×16 blocks that are high-edge **and** bimodal (Otsu separability > 0.62) **and** flat-palette | niche-adaptive |
| Human presence | 6% | RGB ∩ YCbCr skin rule, flood-filled into a region | matches the niche's face rate |

**Shelf legibility is weighted highest on purpose.** The click is decided at
168×94. Detail that does not survive the downscale does not exist.

**Why text detection works the way it does.** Photographic texture has high
edge energy too. What separates real overlay copy is that it sits on a stroke or
a plate, so its luminance histogram is strongly *bimodal* and its palette is
flat. Requiring all three (edges + separability + few colours) is what stops a
gravel driveway from reading as a headline.

---

## Pillar 2 — Title craft · 25%

Scored for how the title performs **in a search result row** — truncated,
skimmed, read next to ten rivals — not as a sentence in isolation.

| Sub-score | Weight | Notes |
|---|---|---|
| **Hook strength** | 24% | Detects *devices*, not keywords (see below) |
| Specificity | 20% | Numbers, timeframes, named entities, outcome words |
| Length & truncation | 16% | 34–62 chars; truncation only penalised if the first 48 chars do not stand alone |
| Keyword placement | 14% | Coverage × position; front-loading rewarded |
| Distinctiveness | 14% | Bigram overlap with the shelf, banded 6–34% |
| Trust & restraint | 7% | Overclaim markers, caps ratio, exclamations — **penalties** |
| Readability | 5% | Syllables/word and word count, one-sided |

### Hook strength detects devices

The naive implementation counts curiosity words ("why", "secret", "nobody").
It fails on the strongest format there is:

> *I cut my AWS bill by 70% in 3 days (nothing broke)*

No curiosity word anywhere. It is a better hook than most titles that have one.
So we detect devices, take the strongest, and reward stacking (+14 each):

| Device | Weight |
|---|---|
| Open loop ("why", "nobody tells you", "what happened") | 62 |
| Quantified result claim (number + timeframe/outcome) | 58 |
| Tension / contrast ("without", "but", "instead of", "vs") | 50 |
| First-person proof ("I tried", "my") | 48 |
| Parenthetical aside | 46 |
| Direct question | 46 |
| Negative frame ("mistake", "stop", "avoid") | 44 |
| Ranking frame ("every", "ranked", "worst") | 42 |

**Trust is a penalty, not a bonus.** Overclaiming buys the click and loses the
session, and YouTube pays for the session. `"YOU WON'T BELIEVE THIS INSANE AWS
HACK!!!"` scores 0 on trust and 46 overall — below a bland but honest title.

---

## Pillar 3 — Pair coherence · 15%

The pillar no competitor has, because it only exists when you score both halves
together.

| Sub-score | Weight | What it catches |
|---|---|---|
| Promise alignment | 34% | A first-person title with no person in frame. A number in the title that is not in the thumbnail. |
| Word redundancy | 30% | Overlay copy repeating title words — half the cell spent saying something already read |
| Combined word load | 20% | Title words + overlay words > 14 = too much for the half-second a scroll gives |
| Overlay discipline | 16% | Over 5 overlay words it stops being a hook and becomes a paragraph |

---

## Pillar 4 — Niche fit & differentiation · 25%

Requires a shelf. Without one it returns a neutral 60 and says so.

**Convention fit (42%)** — do you belong in this result set? Scored against the
fingerprint's face rate, text rate, and tonal medians. If 78% of the shelf leads
with a face and you do not, that is a measured relevance gap, not a style note.

**Differentiation (42%)** — would you be noticed? Cosine distance between hue
histograms, weighted toward the **nearest neighbour** rather than the average.
Average distance hides the real risk: sitting next to one near-identical
thumbnail is what costs the click.

**Shelf quality bar (16%)** — your provisional score against the shelf's median.
Resolved in a second pass, because it depends on the score it feeds.

---

## Shelf simulation

Every competitor runs through the identical pipeline — same analysis, same
pillars, same weights, with the shelf-bar item neutralised. Then the candidate
is inserted and the set is sorted.

That symmetry is the whole point. **"You would rank #3 of 11"** is a real
statement only because both sides were measured the same way.

---

## Modelled CTR band — stated honestly

```
centre = 5.0% × exp( k × (TRC − shelfMedianTRC) ),   k = ln(1.45) / 25
band   = centre × (1 ± spread)
```

A shelf-median thumbnail earns roughly the typical search-surface CTR; each
25 TRC points moves it ~45% relative. Spread widens as confidence drops:

| Confidence | When | Spread |
|---|---|---|
| High | Live API shelf, ≥8 analysed competitors | ±20% |
| Medium | Live shelf ≥4, or fingerprint ≥6 | ±30% |
| Low | Modelled shelf, no live data | ±42% |

**This is an estimate derived from a score, not a measurement**, and the UI says
so wherever it appears. The honest version of this feature is the feedback loop:
record your real CTR on a saved winner, and predicted-vs-actual accumulates in
`trt_saved_winners.actual` for calibration against your own audience.

---

## Ranked fixes

Each weak sub-score becomes a fix carrying the points it is worth:

```
estimatedGain = (100 − itemScore)/100 × itemWeight × pillarWeight × 100
```

Sorted by that number, capped at 8. So the list is ordered by **real impact**,
not by how alarming it sounds — and "Rebuild for the 168×94 cell (+6.0 pts)"
correctly outranks a cosmetic nit.

---

## Grades

| Grade | TRC | Reading |
|---|---|---|
| S | 85+ | Shelf leader |
| A | 72–84 | Strong |
| B | 58–71 | Competitive |
| C | 44–57 | Needs work |
| D | <44 | Will be skipped |

---

## Known limitations

Stated plainly, because a scoring tool that hides its limits is not trustworthy:

- **Face detection is a skin-tone heuristic**, not a trained detector. It is
  reliable for "does this thumbnail lead with a person", and will miss faces at
  extreme angles or under heavy colour grading.
- **Text detection is a proxy.** Very busy flat-colour graphics can read as text
  mass. It measures *overlay-like mass*, not OCR.
- **The CTR model is calibrated on general norms**, not your channel. Treat the
  band as directional until you have recorded actuals.
- **Modelled shelves are not rankings.** With no `YOUTUBE_API_KEY` the
  competitor set is generated from the keyword. Every surface labels it.
- **Scores are not comparable across engine versions.** `engine_version` is
  pinned per row; historical rows are never silently re-scored.
