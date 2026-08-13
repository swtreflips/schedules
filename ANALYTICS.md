# Analytics — Market Structure Behind the Booking

## Core Philosophy

The grid answers one question:

> "Which sailing should I book?"

Analytics answers the questions sitting one level above it:

> "What does this lane actually look like?"
> "Which carrier is genuinely good at it — and where are they weak?"

These are different jobs.

The grid is a **chooser**. It ranks candidates so a decision can be made today.

Analytics is an **explainer**. It shows the routing shapes that exist, which carriers run them, and
who is actually fast — the context that tells you whether today's best option is good or merely the
best of a bad set.

Analytics is not a dashboard. Every number in it must change a booking decision or a forwarder
conversation. If a metric cannot do that, it does not belong here.

---

# Scope — Current Market First, History Later

Analytics reads **`schedules_latest_secure`** — the materialized view — and nothing else in phase 1.

This is a **deliberate change from an earlier draft**, which scoped analytics to the rows the
current grid search had returned. That constraint was fine for corridor and carrier summaries of one
lane, but it makes the carrier-profile view impossible: *"where is this carrier strongest"* requires
many lanes, and a search only ever holds one.

## The two phases

| Phase | Source | Answers | Status |
|---|---|---|---|
| **1 — Current market** | `schedules_latest_secure` | What is the market doing right now? | **Build this** |
| **2 — Historical** | `schedules` base table | How is the market changing? Who keeps their promises? | Later |

Everything in this document is phase 1 unless explicitly marked.

## What the MV actually holds

Measured:

```
1,100 departures    6 carriers    55 lanes    12 POLs    15 PODs
139 carrier-lane cells
```

139 cells is the entire analysis surface for the carrier profile view. Small enough to fetch once
and compute in the browser.

## The 5-day window, and what it hides

`schedules_latest` keeps, per `(carrier_code, port_of_loading, last_cy)`, the newest `query_date`
**within the last 5 days**. A carrier not re-scraped inside that window **disappears entirely**.

This is happening right now:

```
in the base table:  COS, HMM, HPL, MSC, ONE, OOCL, WHL   (7)
in the MV:               HMM, HPL, MSC, ONE, OOCL, WHL   (6)
```

**COSCO is missing.** Not out of the market — just stale in the window.

Two consequences, and the second is worse than the first:

1. COSCO cannot be profiled.
2. **Every lane average COSCO belongs to is computed without them** — so every other carrier's
   "vs lane average" delta on those lanes is subtly wrong.

**Requirement:** the UI must state which carriers are in the current window and when it was last
refreshed. Silent absence is the failure mode here — a carrier vanishing looks identical to a
carrier having no service.

---

# Data Foundation

## Fetch once, compute in the browser

At ~1,100 departures the whole current market is small. Select a **narrow column list** from
`schedules_latest_secure` (skip `raw_schedule`, `route_metadata` and the geometry columns — they
dominate the payload and none of the views need them), hold it in state, and derive every view from
it client-side.

This keeps all three views consistent by construction: they are projections of one array, not three
independent queries that can disagree.

## Fields that carry the structure

From `src/types/schedule.ts`:

| Field | Role in analytics |
|---|---|
| `port_of_loading` | corridor origin, lane key |
| `ts_ports: string[]` | **the transshipment path — core of corridor identity** |
| `port_of_discharge` | ocean terminus, lane key |
| `last_cy` | inland terminus; a rail leg is derived from it |
| `transport_type` | `Direct` / `1 TS` / `2 TS` |
| `transit_time_days` | the comparison metric |
| `etd`, `eta` | cadence, gaps, next departure |
| `cutoff_date` | booking runway |
| `carrier_code` | grouping key for Views B and C |
| `mother_vessel` | **part of departure identity — see Counting Rules** |

## What is NOT in the data

**There is no `final_destination` column.** The warehouse is a search input, not stored data.
Corridors end at `last_cy`; the final drayage to the door is outside this dataset.

---

# Counting Rules

> This section exists because getting it wrong makes the headline number wrong by a third, silently.

## A departure is not a row

The same physical sailing appears **once per Last CY it serves**. One vessel discharging at Long
Beach and railing to Los Angeles, Salt Lake City and Memphis is **one departure and three rows**.

| Source | Rows | Distinct sailings | Inflation |
|---|---|---|---|
| `schedules_latest` (phase 1) | 1,487 | 1,100 | **+35%** |
| `schedules` (phase 2) | 3,319 | 1,960 | **+69%** |

**Rule:** a departure is distinct on

```
(carrier_code, mother_vessel, etd, port_of_discharge)
```

Never `rows.length`. Never `count(*)`. **Deduplicate before any metric is computed**, not per view —
otherwise the three views will disagree about how much service exists.

## Port names must be normalised first

The same port arrives under several spellings:

| Port | Variants found | Uses |
|---|---|---|
| Singapore | `Singapore, Singapore` / `SINGAPORE` / `Singapore` | 738 / 134 / 39 |
| Busan | `Busan, Republic Of Korea` / `PUSAN` / `BUSAN` | 98 / 10 / 7 |
| Port Klang | `Port Klang, Malaysia` / `Port kelang` | 118 / 13 |

Un-normalised, **one 911-sailing Singapore corridor renders as three corridors** with three
polylines and three split counts. It would not look broken — it would look plausible and be wrong.

Normalisation is a **prerequisite, not a refinement.**

## Resolving ports to coordinates

`world_ports` carries `canonical_name`, `name`, `unlocode`, `latitude`, `longitude`, readable to
internal users (`world_ports_internal_read`).

- **51 of 58** distinct `ts_ports` match by name, **with zero ambiguity** — no name resolves to two
  ports, so case-insensitive matching is safe.
- **29 of 29** POL/POD endpoints match.
- `pol_geom` populated on 3,319/3,319 rows; `pod_geom` on 3,276.

The 7 unmatched transshipment ports are recognisable aliases:

```
COCHIN          -> Kochi, India
PUSAN           -> Busan, Republic of Korea
KAOHSIUNG CITY  -> Kaohsiung, Taiwan
TUTICORIN       -> Thoothukudi, India
Port kelang     -> Port Klang, Malaysia
Xiaochan Beach  -> (verify before mapping)
Tan Cang Hiep Phuoc Port JS Company  -> Ho Chi Minh City terminal, Vietnam
```

**Ports that still fail to resolve must render as a gap in the line and be reported, never silently
dropped** — a missing coordinate that quietly disappears turns a 2 TS corridor into a fake direct
one.

**Recommendation:** put normalisation + aliasing in a single `resolve_ports(names text[])` RPC.
Duplicated, it produces two different corridor counts in two different places.

---

# View A — Corridor View

## Goal

Segment a point-to-point lane into its distinct routing shapes, and show them on a map.

## Corridor identity

```
POL → [normalised TS ports, in order] → POD → Last CY
```

Order matters. `Port Klang → Shekou` is not the same corridor as `Shekou → Port Klang`.

## The rail leg is derived

**A rail leg exists when `port_of_discharge <> last_cy`.**

Measured: 1,177 of 3,319 rows (35%) across 53 distinct pairs.

### The exceptions are already visible

| POD → Last CY | Rows | Reality |
|---|---|---|
| Long Beach, CA → Los Angeles, CA | 392 | **Same port complex, ~5 miles.** Not rail. |
| Semarang → Semarang, Indonesia | 43 | **Same place, naming variant.** Not rail. |

Together, 435 rows — **37% of everything the rule calls "rail."**

**Proposed general fix:** a distance guard. `pod_geom` and `last_cy_geom` are already populated, so
treat anything under **~30 miles** as one node with no rail leg. This handles both cases without a
hand-maintained exception list that grows forever. Untested — see Open Questions.

## Per-corridor metrics

Departures · carriers running it · transit **min / median / max** · next ETD · cadence · TS count.

## Why spread, not average

Measured out of Nhava Sheva:

| Corridor | Departures | Carriers | Avg | Fastest |
|---|---|---|---|---|
| Direct → Los Angeles | 15 | 3 | 38.2d | 29d |
| 1 TS Shekou → Los Angeles | 17 | 1 | 44.2d | **28d** |
| 2 TS Port Klang + Shekou → Los Angeles | 18 | 1 | 48.8d | 37d |
| Direct → New York | 23 | 5 | 34.9d | 31d |
| 1 TS Singapore → New York | 27 | 2 | 48.2d | 39d |

The **transshipment corridor via Shekou has a faster best case than direct** — 28 days against 29 —
while being **6 days worse on average.** Averages alone would tell you to dismiss it. Spread tells
you the truth: inconsistent, but its good sailings are the fastest thing on the lane.

**Never display a corridor average without its range.**

## The map

- **MapLibre GL** with **OpenFreeMap** vector tiles — no API key, no billing.
- **Great-circle polylines per leg**, not straight Mercator lines. A straight line from Nhava Sheva
  to Los Angeles is not the route and reads as wrong to anyone who knows the ocean.
- **Ocean legs solid, derived rail leg dashed.** The rail leg is an inference and should not look
  like an observation.
- **Port dots sized by traffic**, so hub structure (Singapore, Shekou) is visible without labels.
- **Line weight by departures, colour by transit** — a thick slow line is a well-served bad option,
  exactly the thing worth spotting.
- **Antimeridian:** Asia→US Pacific corridors cross ±180°. Split those lines or they draw backwards
  across the whole map.

---

# View B — Carrier Comparison

## Goal

A statistical summary **per carrier**, deliberately **not** broken down by corridor. Lower
granularity on purpose: the "who should I be talking to" view.

**No map.** Table-shaped data; a map would add nothing.

## Metrics

Departures · corridors offered · Direct / 1 TS / 2 TS share · transit min / median / max · cadence ·
next departure · largest gap.

## Reading it

Two carriers with identical average transit are not equivalent:

- **weekly, direct, tight spread** → reliable base allocation
- **fortnightly, 2 TS, wide spread** → opportunistic volume

The table makes that distinction visible before rates are negotiated, not after.

---

# View C — Carrier Profile (Strength & Weakness by Lane)

## Goal

Select one carrier. See **where they are strong and where they are weak**, lane by lane.

Views B and C are not the same thing. B compares carriers to each other in aggregate. **C profiles
one carrier across the map.** B tells you who to call; C tells you what to ask them for — and what
not to.

## The central idea: everything is relative

A carrier averaging 33 days on a lane is meaningless alone. It is a **strength** if the lane averages
39 and a **weakness** if the lane averages 26.

**Every metric in this view is a delta against the same lane's competing set.** Absolute transit
times belong in the grid, not here.

## Metrics per (carrier, lane)

| Metric | Definition | Reads as |
|---|---|---|
| **Departures** | distinct sailings on this lane | presence |
| **Share of lane** | their departures ÷ all departures | weight |
| **Transit delta** | their avg − lane avg | **the headline: negative is strength** |
| **Direct count** | departures with `transport_type = 'Direct'` | service quality |
| **TS efficiency** | their TS avg − the lane's **direct** avg | how much their transshipment really costs |
| **Spread** | their min/max vs the lane's | consistency |

## Measured: strengths

Lanes with ≥3 carriers and ≥4 sailings, from the MV:

| Carrier | Lane | Sailings | Their avg | Lane avg | Delta | Direct |
|---|---|---|---|---|---|---|
| MSC | Hai Phong → Oakland | 8 | 24.5d | 37.0d | **−12.5d** | 8 |
| OOCL | Semarang → Long Beach | 5 | 28.2d | 36.7d | **−8.5d** | **0** |
| HPL | Nhava Sheva → New York | 5 | 33.0d | 41.4d | −8.4d | 5 |
| HMM | Semarang → Long Beach | 15 | 28.4d | 36.7d | −8.3d | **0** |
| HMM | Nhava Sheva → Los Angeles | 9 | 33.0d | 39.1d | −6.1d | 9 |

## Measured: weaknesses

| Carrier | Lane | Sailings | Their avg | Lane avg | Delta | Direct |
|---|---|---|---|---|---|---|
| ONE | Hai Phong → Long Beach | 9 | 37.7d | 26.3d | **+11.4d** | 0 |
| WHL | Semarang → Savannah | 12 | 60.3d | 50.0d | +10.3d | 0 |
| ONE | Semarang → Long Beach | 14 | 45.7d | 36.7d | +9.0d | 0 |
| HPL | Laem Chabang → Oakland | 9 | 43.6d | 36.1d | +7.5d | 0 |

This is the whole view in one table: **ONE runs nine sailings a period on Hai Phong → Long Beach and
is 11 days slower than the lane.** That is a conversation to have with a forwarder, and it is
invisible in the grid, which only ever shows you the best option on the day you looked.

## Transshipment efficiency — the metric that overturns an assumption

"Direct is better" is a rule of thumb, not a fact. Compare each carrier's **transshipped** transit
against the **lane's direct** average:

| Carrier | Lane | TS sailings | Their TS avg | Lane direct avg | TS penalty |
|---|---|---|---|---|---|
| HMM | Laem Chabang → Long Beach | 7 | 22.9d | 26.2d | **−3.3d** |
| MSC | Laem Chabang → Oakland | 6 | 31.0d | 33.0d | **−2.0d** |
| OOCL | Laem Chabang → Long Beach | 9 | 25.8d | 26.2d | **−0.4d** |
| WHL | Laem Chabang → Los Angeles | 24 | 27.1d | 25.3d | +1.8d |
| WHL | Laem Chabang → Oakland | 41 | 35.7d | 33.0d | +2.7d |
| HPL | Hai Phong → Los Angeles | 9 | 25.3d | 22.6d | +2.7d |

**HMM's transshipped service on Laem Chabang → Long Beach beats every direct sailing on that lane by
3.3 days.** OOCL essentially matches direct. WHL pays under 3 days for transshipment while running
by far the most volume.

Note the strengths table above: OOCL and HMM are top-5 strongest on Semarang → Long Beach with
**zero direct sailings.** A filter that discards transshipment as a proxy for slow would throw away
the two fastest services on that lane.

**Therefore: transshipment is an empirical question per carrier per lane, and this view is where it
gets answered.**

## Guardrails

- **Minimum sample.** A one-sailing lane is not a strength. Require ≥3–4 departures before rendering
  a delta, and show `n` on every row. The measured tables above use ≥4.
- **Minimum competition.** A delta against a lane the carrier is alone on is meaningless — they
  *are* the lane average. Require ≥2 other carriers, or label it *sole carrier* instead of a number.
- **The missing-carrier problem.** With COSCO out of the window, every lane average they belong to
  is computed without them. State the window; do not pretend it is the market.

## Presentation

A ranked list, strengths at top and weaknesses at bottom, is the whole view. Colour the delta the
way the rates app colours movement — faster than the lane is good, slower is bad — and keep the
absolute numbers alongside so a delta can always be checked against what produced it.

If it goes on the map, **colour lanes by delta from the selected carrier's chair**: their network,
green where they win and red where they lose. That is the single most legible artefact this dataset
can produce.

---

# Further Value — Idea Catalogue

Each states its data prerequisite honestly, so free ones are distinguishable from ones needing new
plumbing.

### 1. ETA reliability / drift per carrier — *phase 2, needs history*

The strongest remaining idea. **582 sailings (30%) had their published ETA revised between
snapshots.** Average slip:

| Carrier | Revised sailings | Avg slip | Worst |
|---|---|---|---|
| OOCL | 24 | **6.3d** | 28d |
| ONE | 118 | 7.4d | 21d |
| WHL | 113 | 7.5d | 22d |
| HPL | 141 | 7.9d | 21d |
| HMM | 88 | 8.1d | 21d |
| COS | 91 | 9.2d | 27d |
| MSC | 7 | 9.4d | 14d |

Drift in the **promise**, before a container moves. A carrier quoting 35 days that slips 9 is
selling a 44-day service.

Sample sizes differ hugely (MSC 7 vs HPL 141) — **display `n` or this is a league table built on
noise.**

This is the natural first payload of phase 2, and it slots straight into View C as a reliability
column beside the transit delta.

### 2. Cadence & gap analysis — *phase 1, free*

The grid shows the next sailing. It never shows that the one after it is 12 days later. Largest gap
between consecutive departures turns "there's a sailing Tuesday" into "there's a sailing Tuesday and
then nothing for a fortnight."

### 3. Cutoff runway — *phase 1, free*

`cutoff_date` is already on every row. Days from now to cutoff is **how much booking time actually
remains**, not how far away the ETD is. A sailing 10 days out with a cutoff in 2 is not a 10-day
decision. Same reasoning as the runway control already shipped in RatesApp.

### 4. Corridor concentration — *phase 1, free*

Corridors run by exactly one carrier are a commercial weakness: no fallback, no tension. Both Nhava
Sheva → LA transshipment corridors above are **single-carrier**; direct LA has three. This tells you
where "that's the only option" is true and where it isn't.

### 5. POD / ramp substitution — *phase 1, free*

Which alternative discharge ports serve the same warehouse, and what substitution costs in days.
Supports the Dallas case directly: Los Angeles + rail versus Houston + rail, on evidence.

### 6. Transshipment risk — *phase 1, free*

Each TS is a handoff and a chance to roll. Cross TS count against transit **spread** to show what
handoffs cost in predictability. Note this is the counterpart to TS efficiency in View C: efficiency
asks whether TS is slower on average, risk asks whether it is *less predictable*. A carrier can win
the first and lose the second.

### 7. Seasonality / capacity trend — *phase 2, needs longer history*

Departures per week per lane over months, to see capacity added or withdrawn. Only ~10 weeks exist
(ETDs 2026-06-01 → 2026-10-06, 4 snapshots), so this is premature.

### 8. Rate join — *needs both datasets*

The largest opportunity and the natural convergence of the two apps: **cost per transit-day by
corridor and carrier.**

A corridor 6 days slower for $400 less is a decision. Today that comparison happens in someone's
head, with rates in one app and schedules in another. Both now live in the same Supabase project
(`sfozxpibfpqsdlxoheyl`), so the join is a schema question rather than an integration project.

Combined with View C this becomes the real prize: **not just where a carrier is fast, but where they
are fast and cheap** — and where they charge a premium for being slow.

---

# Implementation Notes

## Dependency

```
npm install maplibre-gl
```

Views B and C need nothing new — `ag-grid-community` is already present, and plain markup suffices
for a 6-row or 139-row table.

## Data path

`schedules_latest_secure` is a plain view readable to internal users, so `supabase.from(...)` works
directly — no RPC required for phase 1. Select a narrow column list and fetch once.

The only RPC worth adding is `resolve_ports(names text[])`, to keep port normalisation
single-sourced.

## Mounting the view

`src/types/view.ts` is currently:

```ts
export type ViewMode = "carrier" | "rank";
```

Widen it, and add entries to `OPTIONS` in `src/components/ViewToggle/ViewToggle.tsx` — already a
data-driven list, so no structural change. `App.tsx` branches on `viewMode`.

Note analytics does **not** consume `visibleRows`. It has its own fetch and its own scope, so the
grid's CRD and POD filters do not apply to it. Make that visible in the UI, or the two will look
inconsistent and neither will be trusted.

## Suggested phasing

1. **Pure functions first** — dedupe, normalisation, corridor keys, lane aggregates, deltas.
   `Schedule[]` in, plain objects out. No React, no map.
2. **View C (carrier profile)** — highest value per unit of work, needs no map, and every number in
   it is already tabulated above to check against.
3. **View B (carrier comparison)** — mostly a re-aggregation of the same primitives.
4. **View A list** — corridors as rows.
5. **The map last** — purely a rendering of data already proven correct.

**Why this order:** every number in this document was derived by SQL and can be re-derived in Node.
If the aggregates are pure functions, their output can be checked against the tables above without
opening a browser. Build the map first and the only way to test a count is to look at lines and hope.

---

# Open Questions

**1. POD / Last CY exceptions.** The ~30-mile distance-guard proposal is untested. Confirm it
suppresses Long Beach→Los Angeles and Semarang→Semarang without eating a legitimate short rail move.
Deferred by decision.

**2. The 5-day window.** COSCO is absent from the MV today. Is the right answer to widen the
window, surface staleness per carrier in the UI, or fall back to each carrier's most recent snapshot
regardless of age? This affects the correctness of every lane average in View C, so it needs an
answer before that view is trusted.

**3. Minimum-sample thresholds.** ≥4 departures and ≥3 carriers were used for the measured tables
here. They are reasonable, not derived. Worth tuning once the view is in use.

**4. `Xiaochan Beach`** — verify what port this actually is before drawing a line through it.
