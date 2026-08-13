# Analytics — Market Structure Behind the Booking

## Core Philosophy

The grid answers one question:

> "Which sailing should I book?"

Analytics answers the question sitting one level above it:

> "What does this lane actually look like, and who shapes it?"

These are different jobs.

The grid is a **chooser**. It ranks candidates so a decision can be made today.

Analytics is an **explainer**. It shows the routing shapes that exist between two points, which
carriers run them, and which are genuinely faster — the context that tells you whether today's best
option is good or merely the best of a bad set.

Analytics is not a dashboard. Every number in it must change a booking decision or a forwarder
conversation. If a metric cannot do that, it does not belong here.

---

# Scope

Analytics is a **third view**, alongside Plan and Rank.

It operates on **the rows the current search already returned**. It does not re-fetch, does not
widen the date window, and does not query the database independently.

This is a deliberate constraint with a real cost, stated here so nobody is surprised later:

- **Benefit** — analytics can never disagree with the grid. Same rows, same filters, same POD
  exclusions. Zero new data plumbing.
- **Cost** — the underlying `schedules_latest` view is a **5-day window**. Anything requiring
  history across snapshots (schedule reliability, drift, seasonality) **cannot be computed here.**
  Those ideas are catalogued at the end with that prerequisite marked.

The mental model: **analytics summarises the search, it does not replace it.**

---

# Data Foundation

## Where rows come from

`App.tsx` already holds everything analytics needs:

```
rows          — the full server response for the current search
visibleRows   — after carrier / CRD / excluded-POD filters
```

Analytics consumes `visibleRows`, so unchecking a carrier or excluding a POD reshapes the analysis
immediately with no round trip. This mirrors how the grid already behaves.

## Fields that carry the structure

From `src/types/schedule.ts`:

| Field | Role in analytics |
|---|---|
| `port_of_loading` | corridor origin |
| `ts_ports: string[]` | **the transshipment path — the core of corridor identity** |
| `port_of_discharge` | ocean terminus |
| `last_cy` | inland terminus; a rail leg is derived from it |
| `transport_type` | `Direct` / `1 TS` / `2 TS` — a summary of `ts_ports` |
| `transit_time_days` | the comparison metric |
| `etd`, `eta` | cadence, gaps, next departure |
| `carrier_code` | grouping key for View B |
| `mother_vessel` | **part of departure identity — see Counting Rules** |

## What is NOT in the data

**There is no `final_destination` column on the schedules table.** The warehouse (Dallas, in the
motivating example) is a search input, not stored data. It qualifies which `last_cy` values come
back, via the PostGIS radius query.

So corridors end at `last_cy`. The final drayage to the door is outside this dataset entirely.

---

# Counting Rules

> This section exists because getting it wrong makes the headline number wrong by a third, silently.

## A departure is not a row

The same physical sailing appears **once per Last CY it serves**. One vessel discharging at Long
Beach and railing to Los Angeles, Salt Lake City and Memphis is **one departure and three rows**.

Measured against the live data:

| Source | Rows | Distinct sailings | Inflation |
|---|---|---|---|
| `schedules_latest` (what the app reads) | 1,487 | 1,100 | **+35%** |
| `schedules` (base table, all snapshots) | 3,319 | 1,960 | **+69%** |

**Rule:** a departure is distinct on

```
(carrier_code, mother_vessel, etd, port_of_discharge)
```

Never `rows.length`. Never `count(*)`.

## Port names must be normalised first

The same port arrives under several spellings. Measured across `ts_ports`:

| Port | Variants found | Uses |
|---|---|---|
| Singapore | `Singapore, Singapore` / `SINGAPORE` / `Singapore` | 738 / 134 / 39 |
| Busan | `Busan, Republic Of Korea` / `PUSAN` / `BUSAN` | 98 / 10 / 7 |
| Port Klang | `Port Klang, Malaysia` / `Port kelang` | 118 / 13 |

Un-normalised, **one 911-sailing Singapore corridor renders as three corridors** with three
polylines and three split departure counts. The view would not look broken — it would look
plausible and be wrong.

Normalisation is a **prerequisite, not a refinement.**

## Resolving ports to coordinates

`world_ports` carries `canonical_name`, `name`, `unlocode`, `latitude`, `longitude`, and is readable
to internal users (`world_ports_internal_read`).

Coverage, measured:

- **51 of 58** distinct `ts_ports` match `world_ports` by name, **with zero ambiguity** — no name
  resolves to two different ports, so a simple case-insensitive match is safe.
- **29 of 29** distinct POL/POD endpoints match.
- `pol_geom` is populated on **3,319/3,319** rows; `pod_geom` on 3,276. Endpoints need no join at
  all if the geometry is selected.

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

A 7-entry alias map reaches full coverage. **Ports that still fail to resolve must be rendered as a
gap in the line and reported, never silently dropped** — a missing coordinate that quietly
disappears turns a 2 TS corridor into a fake direct one.

**Recommendation:** put normalisation + aliasing in a single `resolve_ports(names text[])` RPC
rather than in the client. It is the one piece of logic that, duplicated, produces two different
corridor counts in two different places.

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

The rule as written produces false rail legs, and the top offenders dominate:

| POD → Last CY | Rows | Reality |
|---|---|---|
| Long Beach, CA → Los Angeles, CA | 392 | **Same port complex, ~5 miles.** Not rail. |
| Semarang → Semarang, Indonesia | 43 | **Same place, naming variant.** Not rail. |

Together, 435 rows — **37% of everything the rule calls "rail."**

**Proposed general fix:** a distance guard. Both `pod_geom` and `last_cy_geom` are already
populated, so compute the separation and treat anything under **~30 miles** as one node with no rail
leg. This handles Long Beach/Los Angeles and Semarang/Semarang without a hand-maintained exception
list that grows forever.

Left open deliberately — see Open Questions.

## Per-corridor metrics

| Metric | Why it earns its place |
|---|---|
| Departures | how much capacity actually runs this shape |
| Carriers | one carrier = no leverage, no fallback |
| Transit **min / median / max** | see below — the mean alone lies |
| Next ETD | can I use this corridor now? |
| Cadence (departures/week) | how long until the next chance |
| TS count | each transshipment is a handoff, and a risk |

## Why spread, not average

Measured out of Nhava Sheva:

| Corridor | Departures | Carriers | Avg | Fastest |
|---|---|---|---|---|
| Direct → Los Angeles | 15 | 3 | 38.2d | 29d |
| 1 TS Shekou → Los Angeles | 17 | 1 | 44.2d | **28d** |
| 2 TS Port Klang + Shekou → Los Angeles | 18 | 1 | 48.8d | 37d |
| Direct → New York | 23 | 5 | 34.9d | 31d |
| 1 TS Singapore → New York | 27 | 2 | 48.2d | 39d |

Read the first two rows carefully.

The **transshipment corridor via Shekou has a faster best case than direct** — 28 days against 29 —
while being **6 days worse on average.** A view showing only averages would tell you to dismiss it.
A view showing spread tells you the truth: it is inconsistent, but its good sailings are the fastest
thing on the lane.

**Therefore: never display a corridor average without its range.**

## The map

- **MapLibre GL** with **OpenFreeMap** vector tiles — no API key, no billing.
- One **great-circle polyline per leg**, not a straight Mercator line. A straight line from Nhava
  Sheva to Los Angeles is not the route and reads as wrong to anyone who knows the ocean.
- **Ocean legs and the derived rail leg styled differently** — solid vs dashed. The rail leg is an
  inference, and should not look like an observation.
- **Port dots sized by traffic**, so hub structure (Singapore, Shekou) is visible without labels.
- Selecting a corridor cross-highlights its row in an adjacent list, and vice versa.
- **Line weight by departures, colour by transit** — a thick slow line is a well-served bad option,
  which is exactly the thing worth spotting.

Note the antimeridian: Asia→US Pacific corridors cross ±180°. Split those lines or they will draw
backwards across the entire map.

## What it answers

- Which routing shapes exist between these two points at all
- Which carriers run which shapes
- Which shapes are genuinely faster, and which are merely faster on a good day
- Where the single-carrier corridors are

---

# View B — Carrier Comparison

## Goal

A statistical summary **per carrier**, deliberately **not** broken down by corridor.

Lower granularity, on purpose. This is the "who should I be talking to" view, not the "which sailing
do I book" view.

**No map.** This is table-shaped data and a map would add nothing.

## Metrics

| Column | Meaning |
|---|---|
| Departures | distinct sailings in the current result set (see Counting Rules) |
| Corridors offered | how many distinct routing shapes they run |
| Direct / 1 TS / 2 TS | share of their service that avoids handoffs |
| Transit min / median / max | consistency, not just speed |
| Cadence | average days between departures |
| Next departure | soonest usable ETD |
| Largest gap | worst wait between consecutive sailings |

## Reading it

Two carriers with identical average transit are not equivalent:

- one running **weekly, direct, tight spread** is a reliable base allocation
- one running **fortnightly, 2 TS, wide spread** is opportunistic volume

The table exists to make that distinction visible before rates are negotiated, not after.

---

# Further Value — Idea Catalogue

Ordered by value. **Each states its data prerequisite honestly**, so the free ones are
distinguishable from the ones needing new plumbing.

### 1. ETA reliability / drift per carrier — *needs snapshot history*

The strongest idea here, and it cannot run off the current search.

The base `schedules` table keeps multiple snapshots. **582 sailings (30%) had their published ETA
revised between snapshots.** Average slip, measured:

| Carrier | Revised sailings | Avg slip | Worst |
|---|---|---|---|
| OOCL | 24 | **6.3d** | 28d |
| ONE | 118 | 7.4d | 21d |
| WHL | 113 | 7.5d | 22d |
| HPL | 141 | 7.9d | 21d |
| HMM | 88 | 8.1d | 21d |
| COS | 91 | 9.2d | 27d |
| MSC | 7 | 9.4d | 14d |

This is drift in the **promise**, before a container ever moves. A carrier quoting 35 days that
slips 9 is selling a 44-day service.

Sample sizes differ hugely (MSC 7 vs HPL 141) — **display `n` alongside, or this becomes a
league table built on noise.**

**Prerequisite:** query the base `schedules` table across snapshots, not `schedules_latest`. This
means analytics gains its own data path. That is the main argument for eventually loosening the
"follows the current search" constraint.

### 2. Cadence & gap analysis — *free, current data*

The grid shows the next sailing. It never shows that the one after it is 12 days later.

Largest gap between consecutive departures, per corridor and per carrier, turns "there's a sailing
Tuesday" into "there's a sailing Tuesday and then nothing for a fortnight" — which is the difference
between a routine booking and an urgent one.

### 3. Cutoff runway — *free, current data*

`cutoff_date` is already on every row. Days between now and cutoff is **how much booking time
actually remains**, as opposed to how far away the ETD is.

A sailing 10 days out with a cutoff in 2 days is not a 10-day decision. This is the same reasoning
already shipped as the runway control in RatesApp, applied to schedules.

### 4. Transshipment risk — *free, current data*

Each TS is a physical handoff and a chance to roll. Cross TS count against transit spread per
corridor to show what handoffs cost in predictability — likely confirming that 2 TS corridors have
materially wider ranges, which would make the trade explicit rather than intuited.

### 5. Corridor concentration — *free, current data*

Corridors run by exactly one carrier are a commercial weakness: no fallback, no competitive tension.
The Nhava Sheva table above shows both LA transshipment corridors are **single-carrier**, while
direct LA has three.

Flagging these tells you where a forwarder's "that's the only option" is true and where it isn't.

### 6. POD / ramp substitution — *free, current data*

Which alternative discharge ports serve the same warehouse, and what the substitution costs in days.
The radius search already qualifies several — this quantifies the trade instead of leaving it to
whoever reads the grid.

Directly supports the Dallas case: Los Angeles + rail versus Houston + rail, compared on evidence.

### 7. Seasonality / capacity trend — *needs longer history*

Departures per week per lane over months, to see capacity being added or withdrawn. Currently only
~10 weeks of data exist (ETDs 2026-06-01 to 2026-10-06, 4 snapshots), so this is premature —
worth revisiting once a few months have accumulated.

### 8. Rate join — *needs both datasets*

The largest opportunity, and the natural convergence of the two apps: **cost per transit-day by
corridor.**

A corridor 6 days slower for $400 less is a decision. Today that comparison happens in someone's
head, with rates in one app and schedules in another. Both now live in the same Supabase project
(`sfozxpibfpqsdlxoheyl`), so the join is a schema question rather than an integration project.

This is where analytics stops describing the market and starts pricing it.

---

# Implementation Notes

## Dependency

```
npm install maplibre-gl
```

View B needs nothing new — `ag-grid-community` is already present, or plain markup will do for a
7-row table.

## Mounting the view

`src/types/view.ts` is currently:

```ts
export type ViewMode = "carrier" | "rank";
```

Widen to include `"analytics"` and add one entry to `OPTIONS` in
`src/components/ViewToggle/ViewToggle.tsx` — it is already a data-driven list, so the toggle needs
no structural change. `App.tsx` then branches on `viewMode` to render analytics instead of
`SchedulesGrid`.

## Suggested phasing

1. **Pure functions first** — normalisation, corridor keys, departure counting, metrics. No React,
   no map. `Schedule[]` in, plain objects out.
2. **View B (carrier table)** — proves the metrics against real numbers with almost no UI.
3. **View A list** — corridors as rows, before any map exists.
4. **The map last** — purely a rendering of data already proven correct.

**Why this order:** every number in this document was derived by query and can be re-derived in
Node. If corridor grouping is a pure function, its output can be checked against the Nhava Sheva
table above without opening a browser. Build the map first and the only way to test a count is to
look at lines and hope.

---

# Open Questions

**1. POD / Last CY exceptions.** The distance-guard proposal (~30 miles, using the existing
`pod_geom` / `last_cy_geom`) is untested. Confirm it suppresses Long Beach→Los Angeles and
Semarang→Semarang without eating any legitimate short rail move. Deferred by decision.

**2. Should analytics eventually get its own data path?** "Follows the current search" was chosen
deliberately and is right for the two headline views. But it permanently excludes idea 1, which is
the most valuable one in the catalogue. Worth revisiting once the corridor and carrier views have
been used in anger.

**3. `Xiaochan Beach`** — verify what port this actually is before drawing a line through it.
