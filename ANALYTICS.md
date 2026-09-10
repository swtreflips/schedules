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
| **1 — Current market** | `schedules_latest_secure` | What is the market doing right now? | **Partly shipped — see below** |
| **2 — Historical** | `schedules` base table | How is the market changing? Who keeps their promises? | Later |

Everything in this document is phase 1 unless explicitly marked.

## What is actually built, as of 2026-09-08

| | Status | Where |
|---|---|---|
| Fetch + paging, whole current market | **shipped** | `src/state/useMarketSnapshot.ts` |
| Option model, dedupe, spread, cadence | **shipped** | `src/lib/analytics/departures.ts` |
| Port-complex folding | **shipped** | `src/lib/analytics/ports.ts` |
| View A — corridor **list** | **shipped** | `corridorStats()` |
| View B — carrier comparison, per lane | **shipped** | `carrierStats()` |
| Lane verdict banner | **shipped** | `src/lib/analytics/rfq.ts` |
| Weekly email report | **shipped** (not in the original scope) | `src/lib/report/` |
| Carrier staleness per carrier | **shipped** | `scrapedByCarrier` |
| **View C — carrier profile across lanes** | **not built** | — |
| **Peer delta / self-relative baseline** | **not built** | — |
| **The map and all corridor geometry** | **not built** | — |
| Cadence, cutoff runway, concentration, POD substitution, TS risk | not built | ideas 2–6 below |

Tests: `npm test` runs `tools/check-analytics.mjs` and `tools/check-report.mjs` against the real
`.ts` sources through a Node resolver hook, so the ordering rules are asserted without a browser or
a database.

**Read Views A and B below as descriptions of shipped behaviour, and View C and Route Geometry as
design.**

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

**Shipped.** `useMarketSnapshot` returns `snapshotAt` and a per-carrier `scrapedByCarrier` map,
rendered as a **Scraped** column on every carrier row and a snapshot date in the header. The view
now reads `schedules_latest_secure`, which applies the freshness window at query time rather than
at refresh time, so a carrier is absent rather than silently stale.

A related trap the window creates, handled separately: a carrier's published routing can change
between scrapes, so the newest snapshot can hold **zero direct sailings for a carrier that runs
them.** WHL was entirely direct on three scrape dates and entirely transshipped on two others.
The Direct column therefore renders **"none"**, never `0` — `CarrierRow.directUnknown`.

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
| `transport_type` | **not used.** Depth comes from `ts_ports.length` — see "Never branch on `transport_type`" |
| `transit_time_days` | the comparison metric |
| `etd`, `eta` | cadence, gaps, next departure |
| `cutoff_date` | booking runway |
| `carrier_code` | grouping key for Views B and C |
| `mother_vessel` | **NOT part of connection identity** — often the feeder, see Counting Rules |
| `vessel_sequence` | part of connection identity |
| `ts_vessels` | the ocean vessel when `mother_vessel` is the feeder |

## What is NOT in the data

**There is no `final_destination` column.** The warehouse is a search input, not stored data.
Corridors end at `last_cy`; the final drayage to the door is outside this dataset.

---

# Counting Rules

> This section exists because getting it wrong makes the headline number wrong by a third, silently.

## A departure is not a row — but the fix below was wrong

The same physical sailing appears **once per Last CY it serves**. One vessel discharging at Long
Beach and railing to Los Angeles, Salt Lake City and Memphis is **one departure and three rows**.

| Source | Rows | Distinct sailings | Inflation |
|---|---|---|---|
| `schedules_latest` (phase 1) | 1,487 | 1,100 | **+35%** |
| `schedules` (phase 2) | 3,319 | 1,960 | **+69%** |

**This draft then prescribed deduplicating on `(carrier_code, mother_vessel, etd,
port_of_discharge)`. Do not. It is wrong for this data, and measurement settles it.** On
Semarang → Los Angeles:

```
200  raw rows
120  under that key          <- discards 40% of real options
198  distinct connections
```

Across the whole current-market view, 2,865 rows hold 2,832 distinct connections. **Genuine
duplication is ~1%, not 57%.**

What that key collapses is not duplicates. `mother_vessel` is frequently the **feeder** — the ship
from the load port to the hub — while the ocean vessel sits in `ts_vessels`. So one feeder sailing
legitimately appears several times with different onward vessels:

```
ONE  HIGHWAY  2026-09-09 -> Los Angeles via Singapore
     onward MOL COURAGE / YM MOVEMENT / ...  ETAs Oct 8, 9, 13, 14  transit 32, 33, 37, 38
```

Four arrivals, four transits, **four things a customer can be sold.** Folding them into one and
keeping whichever row came first discards the options this view exists to compare, and makes the
result depend on row order.

### The shipped rule: a CONNECTION

The unit is one bookable way to move the box from POL to Last CY:

```
(carrier_code, etd, eta, port_of_discharge, vessel_sequence, ts_ports)
```

`ts_ports` is in the key even though `vessel_sequence` already is, because the two can disagree: EMC
publishes EVER BIRTH departing 2026-09-12 for Los Angeles both via Kaohsiung *and* via Taipei, on
the same vessels. Leave routing out and those collapse into one, with row order deciding which
survives — the Taipei corridor lost a connection to Kaohsiung exactly that way before this was
added.

`last_cy` is **excluded**, so a market-wide view spanning several inland ramps does not count one
connection several times. That is the original concern above, handled where it is real: measured, it
affects 45 rows of 2,865, and it matters when counting sailings *across* lanes — it never licensed
collapsing *within* one.

Implemented as `dedupeConnections()` in `src/lib/analytics/departures.ts`.

### The unit that is actually counted: an OPTION

A connection is still not the unit. **A forwarder quotes a CHAIN.** "Direct to Norfolk on the 10th"
and "via Taipei on the 10th" are two things you can ask for — one may come back and the other not,
and if both do you take the direct. That is the unit, and neither count above is it.

```
an OPTION = (carrier, ETD date, chain)
```

Both earlier counts distort it, in opposite directions. Measured on the live snapshot:

- **Connections over-count, by up to 22×.** ONE publishes `Singapore > Los Angeles/Long Beach` on
  2026-09-10 as **22 connections** — 22 onward vessels on one chain on one day. One quotable thing,
  counted twenty-two times. **583 of 1,773** options were inflated this way.
- **Dates under-count, on a fifth of the data.** **334 of 1,707** (carrier, lane, date) cells carry
  more than one chain. ONE out of Pipavav → Chicago on 2026-09-10 reads as **1 date** and is
  **8 options**: direct to LA, direct to Oakland, and six Singapore transships to LA, New York,
  Oakland, Tacoma, Norfolk and Halifax. Six different answers to *"can you do it"*, collapsed to one.

Market-wide: **2,909 connections → 1,742 options.**

Implemented as `toOptions()` in `departures.ts`, built on `dedupeConnections`.

### Options and dates are both shown, and both earn it

| | Counts | Answers |
|---|---|---|
| **Options** | chain × day | **what you can ask a forwarder for** |
| **Sail dates** | distinct ETD days | when a box can actually leave |

Twenty options across three days is not the same proposition as twenty across twenty. Measured, they
**differ on 38% of carrier-lane cells** — median ratio 1.5×, worst 8× — so the second column is not
a restatement of the first.

### An option's transit is the MEDIAN of its arrivals

An option published against several onward vessels has several arrival dates. It carries their
median, not their best: a fastest sailing can be a one-off, which is the same reasoning `mainRoute`
already applies to routings.

This also removes a weighting fault. Aggregating over connections let a chain published 22 times
pull a carrier's median 22 times — the very thing that makes connections a bad count.

**The cost, stated plainly:** spread *inside* an option is no longer visible anywhere. 199 options
carry arrivals that differ from each other, and the extremes are wide — COS `Shanghai > New York`
on 2026-09-18 has arrivals spanning **43 to 69 days** and reports **48**. See §Known weaknesses.

### The invariant this buys

**Direct + 1 TS + 2+ TS === Options, by construction.** An option has exactly one routing depth, so
nothing has to be collapsed to make the columns add up.

The previous model counted *dates* and needed a rule: classify each date by its shallowest routing,
or a carrier offering a 1 TS and a 2 TS on one departure appeared in two columns and the breakdown
did not sum. That rule is deleted. Asserted on live data across **255 carrier-lane cells on 54
lanes** in `tools/check-analytics.mjs`.

Never `rows.length`. Never `count(*)`. **Reduce to options before any metric is computed**, not per
view — otherwise the views disagree about how much service exists.

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

Segment a lane into its distinct routing shapes, so the reader can see every way the market
currently achieves that move.

## The lane is POL → LAST CY

**Not POL → POD.** Last CY is where the customer's box actually ends up; the discharge port is a
routing *choice* made to get it there. Keying the lane on POD would split one commercial lane into
several and make carriers serving it different ways look like they serve different markets.

**This is what makes the corridor table the point of the view rather than a detail of it.** Someone
moving goods from Cartagena to Cincinnati has one lane and one question — *how is that done?* — and
the answer is a list: discharge at Norfolk, or Savannah, or New York, each with its own
transshipment path, transit spread and carriers. Those are alternatives to weigh, not separate
markets, and only a POL → Last CY lane puts them on one screen.

So a lane holding several PODs is **expected and desirable**, not fragmentation to be cleaned up.
The corridor table is where the full picture of a single commercial move lives.

## …and in the app, the lane is POL → THE CUSTOMER'S DOOR

**The same argument, applied once more.** The box does not stop at the Last CY either — it stops at
a warehouse. A Gainesville, FL warehouse is served through Jacksonville by the carriers that cover
it, Savannah by others and Tampa by others again. Those are three answers to one question, and a
POL → Last CY frame puts them on three separate screens.

So there are now **two units, deliberately**:

| | frame | where it lives | drayage |
|---|---|---|---|
| **Destination** | POL → the city the user typed | the Analytics tab | in the ranking |
| **Port pair** | POL → Last CY | "Generate report" | none — every carrier ends in the same place |

The app reads the search (`nearby_schedules` already returns every Last CY inside the radius, a
PostGIS `st_dwithin` on `last_cy_geom`); the report reads the whole market and keeps the strict
comparison. Both are useful and neither replaces the other: the app answers *"how do I get my box to
this warehouse"*, the report answers *"who is good on this port pair"*.

### Last CY becomes part of the option

An option is `(carrier, ETD date, chain, LAST CY)`. The last field is new, and it is invisible
inside a port pair — every row in a lane already shares one canonical Last CY — so **the report did
not move**. Verified against the live market: option counts identical on 73 of 73 lanes, 2,997
either way.

Unscoped, it is load-bearing: **+651 options** that the old pipeline collapsed away across inland
ramps. `dedupeConnections` had to change too, and its old comment said why it should not —
*"`last_cy` is excluded so a market-wide view spanning several inland ramps does not count one
connection several times"*. True under the connection model, wrong under the option model: one
vessel discharging at Savannah for a Savannah Last CY and for an Atlanta ramp is one hull and **two
things a forwarder can be asked to quote**.

### Door transit, and why the ground leg is banded

Once the routings end in different places, ocean transit compares different journeys. Ranking is on
**door transit** — ocean plus the ground leg — measured with HERE truck routing through
`/api/route-batch`, cached in `drayage_routes` (7.9s cold for five novel pairs, 281ms warm).

⚠ **The banding is a judgement, and the alternative was tested first.** Adding raw drive time is
useless: the default radius is 187 straight-line miles, so a ground leg is at most ~225 road miles ≈
4 hours ≈ 0.17 days against a 30-day sailing. Half a percent. A door column built that way is the
ocean column with noise on the end. So:

| road miles | days | why |
|---|---|---|
| ≤ 150 | 1 | local dray — a same-day turn |
| 151–400 | 2 | past local range; the driver cannot round-trip in a shift |
| > 400 | 3 | linehaul |

Measured on the case it was built for — Nhava Sheva → Gainesville, FL at 187 miles: Jacksonville
84 mi and Tampa 137 both band to 1, Savannah 210 bands to 2. Cincinnati (90) and Louisville (67)
into Seymour, IN both band to 1, so there the door ranking equals the ocean ranking and the **miles**
carry the difference. That is the honest answer for that lane, not a failure to discriminate.

**What the banding can and cannot do.** The usable margin is 10% of the lane median and the banding
spans 1–3 days, so drayage only pushes a routing out of reach when 2 days exceeds a tenth of the
lane — i.e. on **short** lanes. On a 30-day trans-Pacific it never will, and the tests say so in
both directions rather than claiming a discrimination the numbers do not support.

### The dray is measured from the LAST CY, not the discharge port

They differ often, and the difference is the whole point. On Nhava Sheva → Gainesville, **26 of 53
rows** discharge at Savannah with a Last CY of Tampa — the carrier carries the box on, and the
customer's drayage starts at Tampa (137 mi), not Savannah (210). A service line naming only the
chain would read as Savannah being 137 miles away, so the row names both:

```
Savannah, GA → Tampa, FL  ×6 · 46d · 137mi
Savannah, GA              ×9 · 30d · 210mi     (POD and Last CY are the same place)
```

## Corridor identity

```
[normalised TS ports, in order] → POD
```

within a lane already fixed at POL → Last CY. Order matters: `Port Klang → Shekou` is not the same
corridor as `Shekou → Port Klang`.

**POD is part of the corridor even though it is not part of the lane**, and for an inland Last CY it
is the single biggest thing separating one routing from another. Measured on `Salt Lake City, UT`,
reached through four discharge ports:

| POD | Connections | Median |
|---|---|---|
| Long Beach, CA | 11 | 31.0d |
| Los Angeles, CA | 36 | 33.5d |
| Oakland, CA | 77 | 40.0d |
| Houston, TX | 12 | 77.5d |

Same box, same final destination, **46 days between the best and worst way of getting there** — a
Gulf discharge with a long rail leg against a West Coast one. Collapsing those into one lane average
would hide the entire decision.

Implemented as `routeLabel()` in `src/lib/analytics/ports.ts`; corridor rows are built by
`corridorStats()` in `src/lib/analytics/lane.ts`.

## The rail leg is derived

**A rail leg exists when `port_of_discharge <> last_cy`.**

Measured: 1,177 of 3,319 rows (35%) across 53 distinct pairs.

### The exceptions are already visible

| POD → Last CY | Rows | Reality |
|---|---|---|
| Long Beach, CA → Los Angeles, CA | 392 | **Same port complex, ~5 miles.** Not rail. |
| Semarang → Semarang, Indonesia | 43 | **Same place, naming variant.** Not rail. |

Together, 435 rows — **37% of everything the rule calls "rail."**

**Shipped: a port-complex list, not the distance guard.** The proposal here was a ~30-mile geometry
check. What went in instead is an explicit `COMPLEXES` table in `src/lib/analytics/ports.ts`, and
the rail test is `!samePlace(pod, last_cy)`.

The distance guard was the more general idea and is the weaker one. Two berths belong together when
a box landing at either is **the same operational outcome** — same rail ramps, same drayage market —
and that is a commercial judgement, not a distance. A guard tuned to swallow Long Beach → Los
Angeles (~5 miles) says nothing about whether Seattle and Tacoma should fold, and a guard loose
enough to catch a genuine short rail move would be wrong in the other direction. The list is
deliberately conservative and carries its reasoning: today it holds San Pedro Bay only, with
Seattle/Tacoma and New York/Newark named as plausible next entries that are *not* added on a guess.

**The complex folds at lane level too**, which the earlier draft did not anticipate. Carriers
publish Last CY as either `Los Angeles, CA` or `Long Beach, CA` for what is commercially one
delivery; keying the lane on the raw value split seven load ports into two lanes apiece, and Ho Chi
Minh → Long Beach carried 69 options that never appeared in the Ho Chi Minh → Los Angeles table.
Half a market missing from a comparison is worse than an extra row in a lane picker.

Scope is routing identity only: transshipment counts still come from `ts_ports`, and
`CarrierRow.pods` still lists discharge ports as published, so a reader who needs the berth can see
it.

## Per-corridor metrics

Shipped in `CorridorRow`: via path · POD · TS count · rail-leg flag · **options** · sail dates ·
carriers · transit **min / median / max** · next ETD.

**Options is the headline, dates the secondary.** It is tempting to think they must match here,
since the chain is fixed within a corridor row — they do not. A corridor spans carriers, so two of
them sailing one routing on one day are two things you can be quoted and one day you can leave. See
Counting Rules.

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

**Never display a corridor average without its range.** Shipped as `SpreadCell`, which also prints
`n/of` when some connections have no published transit — `transit_time_days` is genuinely null in
production, and a confident median over an unstated subset is worse than saying so.

## The map — NOT BUILT

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

The corridor **list** is shipped; none of the geometry below it is. See Route Geometry, which
remains a design rather than a description.

---

# View B — Carrier Comparison

## Goal

A statistical summary **per carrier**, deliberately **not** broken down by corridor. Lower
granularity on purpose: the "who should I be talking to" view.

**No map.** Table-shaped data; a map would add nothing.

Scoped to **one lane at a time**, driven by the lane picker — not the whole market at once.

## Metrics — as shipped in `CarrierRow`

Direct / 1 TS / 2+ TS **options** · options · sail dates · avg TS · main service and its median ·
all-options median / range · spread · vs lane · sailing window · last scraped.

Three of these were not in the original list and each exists because a measured row was misleading
without it:

**Direct / 1 TS / 2+ TS count OPTIONS, and sum to Options by construction.** This used to count
dates, which forced a rule: classify each date by its shallowest routing, or a carrier offering a
1 TS and a 2 TS on one departure appeared in two columns and the breakdown did not add up. An option
has exactly one routing depth, so there is nothing to collapse and nothing to explain. `avgTs` is
option-weighted for the same reason it is counted that way — connection-weighting let a chain
published against 22 vessels count 22 times toward a carrier's routing depth.

**Usable services** replaced the single *Main service* column. A carrier is rarely one service, and
describing it by its busiest routing alone reads correctly only when everything else it runs is much
worse. See §The usable-service test below.

**Main service** is still computed — it is `services[0]`, the routing a carrier offers the most
options on, with the median *that* routing delivers — the honest headline, not the best case. WHL
shows a 15-day best on Semarang → Los Angeles while the service it actually offers runs 20.5. It is
now the *first line* of the stack rather than the whole story.

### The usable-service test

> A service is **usable** when its median transit is no worse than the lane median + 10%.

The margin is not a new constant. `MATERIAL_GAIN = 0.1` already defined the smallest difference
worth acting on, for the thin-service exemption. Turned around, it gives the definition for free: a
routing inside the margin is not materially *slower* than typical, so it is one a customer can live
with. Two numbers that must agree by hand would have been worse than one.

Calibrated across all 255 carrier-lane cells before choosing +10%:

| tolerance | 0 usable | exactly 1 | 2+ usable | options kept |
|---|---|---|---|---|
| +0% | 74 | 126 | 55 | 50% |
| **+10%** | **43** | **131** | **81** | **66%** |
| +20% | 31 | 128 | 96 | 79% |
| +30% | 17 | 125 | 113 | 88% |

+10% separates the three real populations. At +20% and above "usable" stops excluding anything.

**Why it is not called "secondary service".** The team's intuition was *primary vs secondary*, and
the data does not support that framing: `mainRoute` is picked by option count, not speed, so the
second service is **faster** than the main one in **44 of 142** carrier-lane cells with two or more.
ZIM's Yantian routing on Laem Chabang → LA/LB runs 23 days against its own main service at 25. The
question worth answering is not *how bad is the secondary* but **how many of this carrier's routings
are worth quoting**.

Two edge cases, both deliberate:

- **No lane median** (no carrier published a transit) → every service stays usable. There is nothing
  to fail against, and zeroing the lane would read as "nobody here is any good".
- **A service with no median of its own** is not usable, on the standing rule that a carrier which
  has published no transit is not a fast one.

**What it changed in the sort.** Two edits, both tiebreaks — the lead is still direct options:

1. The thin-service guard counts **usable** options, so the lane's yardstick is what can actually be
   booked. This flips `thin()` on **59 of 238 cells** and reorders **5 of 37** multi-carrier lanes,
   in both directions: HPL on Ho Chi Minh → LA/LB offers 6 options and *all six* are usable, and was
   demoted as thin against a yardstick built from another carrier's 36 options, 23 of which nobody
   would book. OOCL on Laem Chabang → LA/LB goes the other way — 21 options, 6 usable, correctly
   demoted.
2. **More usable routings breaks a tie** ahead of raw speed, below the thin guard. Depth is a reason
   to prefer a carrier, not a reason to promote one whose service is too small to rely on.

### What the test revealed about the market

Measured on the live snapshot — 2,188 options, 511 carrier-services, 255 carrier-lane cells.

**A third of the published market is noise.** 736 of 2,188 options (34%) sit on a routing materially
slower than its lane's median; 173 of 511 services (34%) are not worth quoting at all.

**Depth is the exception, not the rule.**

| what the carrier gives you on that lane | cells | share |
|---|---|---|
| out of reach — 0 usable routings | 43 | 17% |
| single-threaded — exactly 1 | 131 | 51% |
| a real alternative — 2 | 52 | 20% |
| genuinely deep — 3+ | 29 | 11% |

**68% of carrier-lane pairs offer one usable way in, or none.** That is the finding that justifies
the column: most of the time it reads "1", and *that is the information* — there is no fallback if
the service is full.

**Five of 33 multi-carrier lanes have no carrier with a second usable routing** — Nhava Sheva →
Huntsville, Hai Phong → Philadelphia, Mundra → New York, Puerto Quetzal → LA/LB, and Qingdao → LA/LB
(12 carriers, not one of them with a backup). These are the lanes where "that's the only option" is
literally true, and nothing else in the view says so.

**Carrier behaviour is consistent enough to be a property of the carrier.** This is a cross-lane
view the per-lane table structurally cannot show, and the clearest argument for building View C:

| carrier | lanes | options | usable | % real | deep lanes | out of reach |
|---|---|---|---|---|---|---|
| MSC | 20 | 197 | 180 | **91%** | 3 (15%) | 1 (5%) |
| EMC | 16 | 105 | 81 | 77% | **9 (56%)** | 2 (13%) |
| MSK | 22 | 115 | 87 | 76% | 8 (36%) | 4 (18%) |
| WHL | 16 | 242 | 169 | 70% | 6 (38%) | 3 (19%) |
| HMM | 24 | 249 | 170 | 68% | 5 (21%) | 5 (21%) |
| YML | 20 | 124 | 81 | 65% | **11 (55%)** | 4 (20%) |
| HPL | 25 | 209 | 136 | 65% | 7 (28%) | **8 (32%)** |
| OOCL | 17 | 102 | 65 | 64% | 5 (29%) | 1 (6%) |
| COS | 23 | 243 | 153 | 63% | 7 (30%) | 5 (22%) |
| ONE | 28 | 189 | 115 | 61% | 11 (39%) | 2 (7%) |
| CMA | 30 | 275 | 146 | **53%** | 7 (23%) | 3 (10%) |
| ZIM | 14 | 138 | 69 | **50%** | 2 (14%) | **5 (36%)** |

Two distinct strategies fall out of it. **MSC publishes little and almost all of it is competitive**
(91% real, out of reach on one lane in twenty) — a narrow, clean network. **CMA publishes the widest
network in the dataset (30 lanes, 275 options) and half of it is not worth quoting.** Neither is
visible from any single lane. EMC and YML are the carriers that habitually give you a choice.

**The trade-off is real and it is never free.** On **24 lanes the fastest carrier is not the one
with the most ways in**, and on every one of those 24 the deeper carrier is slower — by 2 to 6 days:

| lane | fastest | deepest | cost |
|---|---|---|---|
| Laem Chabang → LA/LB | MSC 23d, 1 way | ZIM 25d, 3 ways, 27 options | +2.0d |
| Laem Chabang → Oakland | EMC 30d, 2 ways | WHL 32d, 3 ways, 34 options | +2.0d |
| Ho Chi Minh → LA/LB | WHL 22d, 1 way | EMC 25d, 4 ways, 13 options | +3.0d |
| Hai Phong → New York | ZIM 36.5d, 1 way | YML 40.5d, 5 ways, 20 options | +4.0d |
| Semarang → Savannah | HMM 47d, 2 ways | HPL 53d, 4 ways, 14 options | +6.0d |

There is no lane where depth comes for free. That is the honest shape of the decision the table now
puts in front of the reader: **two days for triple the ways in** is a judgement a person should make,
and the view's job is to show both numbers rather than to resolve it with a score.

Counting options removes a trap rather than guarding against it. Under connections a routing looked
popular for being *duplicated*: OOCL on Ho Chi Minh → Los Angeles had a Ningbo double-transship with
8 connections across 2 dates against a direct with 3 across 3, so connections named the 2 TS chain
as its main service on a row whose columns read 4 direct. Eight connections on two days are two
options, so it cannot happen.

**Sailing window** (first → last ETD) separates a service that is *small* from one that is *ending*.
On Semarang → Savannah, EMC's four dates run Aug 30 – Sep 12 while HMM runs to Oct 23: fine for a
box moving in ten days, useless beyond that, and identical without this column.

**Spread** gets its own column rather than living inside the range, because it decides bookings and
was unreadable there. On Semarang → Savannah HMM has the most sailings on the lane and a 27-day
spread (38–65) against MSC's 10 (40–50) — the best-served carrier is the least predictable, which
the median conceals.

## No score, and no tier label

Both were built and **deliberately removed.** An earlier version ranked carriers with a weighted
"chances" number and tagged each row Preferred / Viable / Avoid. A score asks the reader to trust an
arithmetic they did not choose; a label states the conclusion instead of letting them reach it.

**The sort is the argument.** Ordered by direct dates → fewest average transshipments → thin
services demoted → median → dates. The carrier worth calling is the top row, and every column that
put it there is on that row.

Two refinements the ordering needed, both from real lanes:

- **Thin services drop behind substantial ones before speed is considered.** A fast median off three
  options is not the same claim as one off twenty; without this the smaller number simply wins.
  Ordering on median alone put COS second on Semarang — 29 days across 3 sailings, ahead of HMM's 31
  across 20. "Thin" is relative to the lane (a quarter of the best-served carrier's options), because
  a busy lane and a quiet one cannot share an absolute threshold. It counts **options** rather than
  dates so the sample size matches the statistic it guards — the median is computed over options.
- **But a thin service that is materially faster is not demoted.** The rule exists to stop three
  sailings outranking twenty on a two-day edge, not to bury a real advantage. EMC on Semarang →
  Savannah runs 4 dates at 44.5 against a 54.5-day lane — ten days, 18% — and sank to last behind
  carriers it beats outright. **Naming a carrier in an RFQ costs nothing** — it is a rate request,
  not a booking — so a candidate that good must surface and let the reader weigh its 4 dates. The
  margin is 10% of the lane median: it clears EMC's 18% while still catching 29-against-30 at 3%.

## Reading it

Two carriers with identical average transit are not equivalent:

- **weekly, direct, tight spread** → reliable base allocation
- **fortnightly, 2 TS, wide spread** → opportunistic volume

The table makes that distinction visible before rates are negotiated, not after.

## The lane verdict

One line above the table saying what kind of market this is — `healthy` / `mixed` / `tough`
(`laneVerdict()` in `src/lib/analytics/rfq.ts`). **Descriptive, not prescriptive:** an earlier
version printed a ready-made "please quote HMM and WHL" sentence, which turns a table the reader can
interrogate into an instruction they must trust.

It exists because a lane with no direct service has to read as a **hard market** rather than as a
broken screen — 10 of the 51 lanes in the current snapshot have none, and direct is only 19% of
options market-wide. Silence there looks like a bug and gets the whole view distrusted.

The banner reads **"N% of options are direct"** rather than of dates: a day carrying a direct and
two transships used to count wholly as direct, which overstated how easy the lane is.

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

## Two baselines — and why one comes first

There are two defensible ways to say a carrier is "strong on this lane":

| | Baseline | Answers | Moment |
|---|---|---|---|
| **Peer-relative** | the other carriers **on this lane** | "Should I book them here?" | booking |
| **Self-relative** | that carrier's **own other lanes** | "What should I give them in the RFQ?" | allocation |

Both are real. **Build peer-relative first — it is the primitive, and self-relative is computed from
it.**

### Self-relative cannot be built on raw transit

Comparing a carrier's transit across different lanes compares different distances. Measured, HMM's
network sorted by their own average transit:

| Lane | Their avg | Lane avg | Peer delta |
|---|---|---|---|
| Qingdao → Long Beach | **20.0d** ← their fastest | 22.9d | −2.9d |
| Laem Chabang → Long Beach | 23.3d | 25.2d | −2.0d |
| **Semarang → Long Beach** | 28.4d | 36.7d | **−8.3d** ← their strongest |
| Laem Chabang → New York | 40.7d | 48.5d | **−7.9d** |
| Nhava Sheva → New York | 44.8d | 41.4d | **+3.4d** |
| Nhava Sheva → Savannah | 58.2d | 53.2d | +5.0d |

Their *fastest* lane is only 2.9 days better than rivals — unremarkable. Their *strongest* lane is 8
days slower in absolute terms and 8.3 days better than everyone on it. And rows 4 and 5 are within 4
days of each other absolutely while being a strength and a weakness respectively.

**Ranking a carrier's own lanes by raw transit ranks distance, not performance.**

### So self-relative is a delta of the delta

The correct form: rank a carrier's lanes by **peer delta**, then compare each against **that
carrier's own mean peer delta**.

HMM averages roughly **−2.4 days** against peers across their 16 qualifying lanes — that is their
house standard. Read against it, Semarang → Long Beach (−8.3) is ~6 days better than they normally
manage, while Qingdao (−2.9) is half a day better: ordinary, *for them*.

This is why the ordering matters. Once peer delta exists as a column, self-relative is one more
aggregation over the same numbers — **no new data path, no new query.** Built the other way round,
you would be ranking distances and would have to throw it away.

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

# Route Geometry — Storing and Plotting Corridors

## The model: legs, never whole corridors

`sea_routes` is already the right shape. It keys on `(origin_port, destination_port)` and carries
`geojson`, `route_geom`, `distance_km`, `duration_hours`. Nothing about its structure needs to
change — **it is a leg table, and it needs filling rather than redesigning.**

Store one geometry per **leg**, and compose corridors from them at render time.

The alternative — a polyline per corridor — duplicates shared water. Nhava Sheva → Shekou → Los
Angeles and Nhava Sheva → Shekou → Oakland are two rows that hold the same first half twice, and a
third corridor through Shekou stores it a third time. Legs are written once and reused by every
corridor that crosses them.

**Measured, this is the whole of it:**

| | |
|---|---|
| Sailings in the MV | 2,559 |
| Distinct legs that draw all of them | **288** |
| Already in `sea_routes` | 29 (the direct pairs) |
| Still to generate | 259 (the transshipment legs) |

**On storage alone the two models are a wash, and it is worth being straight about that.** There are
**286 distinct corridors against 288 distinct legs** — near enough 1:1. Comparing 288 legs to 2,559
sailings flatters the leg model: sailings repeat the same corridor 8.9 times on average, and that
repetition is free under either scheme. Corridor-level reuse of a leg is roughly 2×, and 16 legs
(6%) are used by exactly one corridor, where the model is pure overhead.

**The argument for legs is marginal cost, not total cost.**

Carrier services churn. A new discharge port or a swapped transshipment mints a brand-new corridor,
which under whole-corridor storage means a brand-new polyline to generate. Under legs, if both its
pairs already exist the corridor draws for **nothing**. Corridor count tracks commercial decisions;
leg count tracks the port graph, which is far more stable. Today's counts match — a year of
reshuffling is what separates them.

Two supporting reasons, neither decisive alone: `sea_routes` is already keyed this way with 29 rows
done, so corridors would mean starting over under a different key; and a bad stretch of water is
corrected once in a leg rather than in every corridor polyline that baked it in.

**The cost, stated plainly:** a leg asserts that the water between two ports is a property of the
*pair*. It is really a property of the *service* — see the routing variants below — and chained legs
meet at a seam that a single corridor polyline would not have. For a view drawing market structure
that approximation is fine; for tracking or ETA work it would not be.

## The chain is already in the data

**`route_ports` is the complete ordered sequence** — POL first, POD last, transshipments in
between, for every transport type:

```
Direct  ["Hai Phong, Vietnam", "Long Beach, CA"]
1 TS    ["Nhava Sheva, India", "Shekou, China", "Los Angeles, CA"]
5 TS    ["Pipavav, India", "COCHIN", "Colombo, Sri Lanka", "Tema, Ghana",
         "Barcelona, Spain", "Cartagena, Colombia", "Charleston, SC"]
```

So the whole derivation is:

```
legs(schedule) = consecutive pairs of route_ports
              = [(p[0],p[1]), (p[1],p[2]), … , (p[n-1],p[n])]
```

Worked through the motivating example: a sailing Nhava Sheva → Los Angeles transshipping at Taipei
has `route_ports = ["Nhava Sheva, India", "Taipei", "Los Angeles, CA"]`, which yields
`Nhava Sheva→Taipei` and `Taipei→Los Angeles` — two lookups, both already stored in isolation, and
the map draws the chain.

## Never branch on `transport_type`

**A direct sailing is not a special case. It is a chain of length two.**

The renderer should never ask "is this direct?" — it takes `route_ports`, walks the pairs, and
draws what it finds. One code path covers Direct through 6 TS and whatever appears next.

This is not a stylistic preference. `src/types/schedule.ts` declares:

```ts
export type TransportType = "Direct" | "1 TS" | "2 TS";
```

The live data says otherwise:

| transport_type | sailings | chain length | legs |
|---|---|---|---|
| Direct | 548 | 2 | 1 |
| 1 TS | 1,533 | 3 | 2 |
| 2 TS | 448 | 4 | 3 |
| 3 TS | 8 | 5 | 4 |
| 5 TS | 21 | 7 | 6 |
| 6 TS | 1 | 8 | **7** |

**The type is wrong and must be widened**, but the deeper point is that any code keyed on it would
have silently mishandled 30 sailings today and an unknown number tomorrow. Chain length is derived
from the data; the label is a description of it.

## Do not reconcile `route_ports` against the endpoint columns

A measured chain ends `"Lazaro Cardenas, Mexico"` while that row's `port_of_discharge` is
`"Lazaro Cardenas, Mic"` — the same port under two spellings. Treat `route_ports` as the single
source of truth for geometry, and do not assert `route_ports[-1] === port_of_discharge`. An
equality check there fails on real rows.

## Populate `sea_routes` with the SAME names the corridor key uses

This is the one place the geometry work and the counting work must agree.

Corridor identity normalises port names — `Singapore, Singapore` / `SINGAPORE` / `Singapore` are
one port, or the corridor fragments into three (see Counting Rules). If leg geometry is keyed on
raw `route_ports` strings while corridor identity is keyed on normalised ones, then one corridor
owns legs under several spellings and the merge that fixes the counting breaks the drawing.

**Normalise once, and store `sea_routes` rows under the normalised name.** The 259 legs still to
generate should be written that way from the start; it is far cheaper than re-keying later.

## Leave room for routing variants in the key — before generating the 259

The same port pair can be sailed two ways. Nhava Sheva → Rotterdam via Suez and via the Cape of
Good Hope is one pair and two completely different lines, and **carriers do not state which on the
schedule.**

The intended answer is to resolve it from the vessel rather than the schedule: track vessels through
MarineTraffic, learn what the service actually does, flag it on the vessel record, and pick the
matching geometry. That work is deferred — but it decides the primary key, and the key has to be
right *before* 259 rows exist under it.

**The table currently forbids this.** `sea_routes` carries
`PRIMARY KEY (origin_port, destination_port)`, so a Suez row and a Cape row for the same pair cannot
coexist — the second insert is rejected. The variant is not merely unmodelled; it is blocked.

Widen the key while the table holds 180 rows rather than 439:

```sql
alter table sea_routes add column routing_variant text not null default 'default';
alter table sea_routes drop constraint sea_routes_pkey;
alter table sea_routes add primary key (origin_port, destination_port, routing_variant);
```

Every leg generated today is written as `'default'` and behaves exactly as it does now; lookups that
do not care pass `'default'` and are unaffected. When the vessel data lands, the two variants coexist
and the resolver picks between them. Done afterwards, the same change is a migration over a full
table plus edits to the RPC signature and the client's `Map` key.

**One gap the existing key does not close.** It is case-sensitive on raw text, so `Singapore`,
`SINGAPORE` and `Singapore, Singapore` are three legal, distinct origins pointing at one port. The
primary key will not stop the fragmentation described above — only generating under normalised names
will. Worth folding the `lower()` into the new key if the generator cannot guarantee casing.

## The render unit is the corridor, not the sailing

Do not walk the result set drawing a chain per schedule row. Group by `route_ports` first and draw
each distinct corridor once.

Measured on the busiest lane, Nhava Sheva → Los Angeles:

| | |
|---|---|
| Sailings | 122 |
| Distinct corridors | **10** |
| Distinct legs to fetch | **17** |

Per-row plotting plots the same ten lines about twelve times each, stacked on identical pixels. It
costs twelve times the work to produce exactly the same picture. Across the estate there are 66
lanes averaging 4.4 corridors each, with 14 on the worst.

The sailings that collapse into a group are not lost — they become the corridor's weight
(departures, carriers, transit spread), which is what should drive line thickness and colour.

**Give the geometry function a chain, not a schedule:**

```
chainGeometry(route_ports: string[]) → LineString[]
```

The corridor view feeds it deduped corridors. A future "show me this sailing's path" from a grid row
feeds it one row's array. Same function, no special case, and the geometry layer never needs to know
whether it is drawing one sailing or a thousand.

**Ten to fourteen lines on one lane is the real risk, and it is visual rather than technical.** 17
legs is one small round trip that caches forever; cost is not the problem. Legibility is. A corridor
with 40 departures and one with 2 must not look alike, or the map is spaghetti — weighting by
departures is what turns the picture into a statement.

## Fetching: one round trip, deduped in SQL

Corridors share legs heavily, so never fetch per corridor. An RPC that takes the same scope as the
view, unnests `route_ports`, and returns the **distinct** legs joined to their geometry:

```sql
create or replace function corridor_legs(...)
returns table (origin_port text, destination_port text, geojson jsonb, distance_km numeric)
```

The client then never assembles a pair list at all — it receives exactly the geometries the current
view needs, once, and builds a `Map` keyed `"a→b"`. Each corridor is then an ordered array of
lookups into that map, rendered as one feature with the corridor id as a property so selection and
hover work off the same object.

Add a unique index on `(lower(origin_port), lower(destination_port))` for the join.

Legs are static once generated — they describe water, not schedules — so they cache indefinitely
and never need revalidating when a snapshot refreshes.

## A missing leg must be loud

If a pair has no geometry, draw a **dashed great-circle placeholder** and mark the corridor
incomplete.

Silently skipping it is the dangerous failure: a 2 TS corridor missing its middle leg renders as a
straight line from origin to destination and reads as a *direct sailing*. That is the same trap as
an unresolved transshipment port, and it produces a map that looks fine and lies.

With 259 legs outstanding, this is the normal state for a while rather than an edge case, so build
the placeholder before the happy path.

## Two rendering details that will bite

**The antimeridian.** Asia→US Pacific legs cross ±180°. A LineString whose longitudes jump from
179 to -179 draws backwards across the entire map. Split those legs, or normalise longitudes to a
continuous frame before handing them to MapLibre.

**Reuse `distance_km`.** `sea_routes` already carries routed distance and duration per leg, so
summing a chain gives real sailed distance per corridor — better than great-circle, and a free
column for the corridor table in View A.

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

1. ~~**Pure functions first**~~ — **done.** Dedupe, normalisation, corridor keys, lane
   aggregates. `Schedule[]` in, plain objects out, no React, no map — which is what lets
   `tools/check-analytics.mjs` assert the ordering rules in Node.
2. **View C (carrier profile), peer-relative only** — **not built, and now the biggest gap.** Steps
   3 and 4 were done first because a per-lane table was what the team needed to run an RFQ; the
   cross-lane profile is still the highest-value thing left. Needs no map, and every number in it
   is already tabulated below to check against. Make `peerDelta` a first-class field on the
   per-(carrier, lane) record, because step 6 reads it again.

   Note `carrierStats` already computes `vsLaneMedian` — a carrier against the lane's MEDIAN
   CARRIER, within one lane. That is not `peerDelta` (their mean against the lane's mean, across
   every lane they run) and should not be mistaken for a head start on it.
3. ~~**View B (carrier comparison)**~~ — **done**, and it became the primary table rather than a
   secondary one: scoped per lane, it is the screen someone actually reads before an RFQ.
4. ~~**View A list**~~ — **done**, corridors as rows beneath the carrier table.
5. **The map last** — purely a rendering of data already proven correct. Still last, still
   unbuilt.
6. **Self-relative baseline** — a toggle on View C between "vs other carriers on this lane" and "vs
   this carrier's own network". Deliberately last, and cheap by then: it is an aggregation over the
   `peerDelta` column from step 2, not a new query.

**Why this order:** every number in this document was derived by SQL and can be re-derived in Node.
If the aggregates are pure functions, their output can be checked against the tables above without
opening a browser. Build the map first and the only way to test a count is to look at lines and hope.

---

# Known weaknesses of the option model

The option is the right unit — it is what a forwarder quotes — but it is not a quality measure, and
three things follow from that. All three are measured, none is fixed.

## 1. ~~The count rewards publishing breadth~~ — FIXED by usable services

*Superseded. Kept because the diagnosis was right and the fix follows from it directly.*

An option costs a carrier nothing to publish. Measured, routings published per departure day:

| Carrier / lane | Options | Dates | Ratio | Median |
|---|---|---|---|---|
| COS Pipavav → Chicago | 16 | 4 | **4.0×** | 64.5d |
| CMA Pipavav → Pittsburgh | 20 | 5 | **4.0×** | 68.3d |
| CMA Laem Chabang → Philadelphia | 79 | 22 | **3.6×** | 61d |
| YML Hai Phong → Salt Lake City | 25 | 11 | 2.3× | 38d |

**Every high-ratio cell is also a slow one.** CMA's 79 options on Laem Chabang → Philadelphia
include 37 that route through **Melbourne, Brisbane and Tauranga** at 60–65 days — real
round-the-world strings, commercially absurd for Thailand → US East Coast. The option count says
CMA is the richest carrier on that lane. It is the worst.

**The fix is to count only what is worth quoting.** See §The usable-service test. Measured
market-wide, **736 of 2,188 published options (34%) sit on a routing materially slower than its own
lane's median** — they are noise on the lane they appear on, and they no longer inflate anything.
The old advice — *"what saves the reader is the sort, not the count; never rank on options"* — is no
longer the only defence: the count itself now discriminates.

## 2. Spread inside an option is now invisible

An option carries the median of its arrivals, and the `Spread` column measures variation *between*
options. Variation *within* one is reported nowhere. **199 options carry arrivals that differ**, and
the extremes are severe:

```
COS  | 2026-09-18 | Shanghai > New York     3 arrivals   43-69d   reported as 48
OOCL | 2026-09-10 | Shanghai > Oakland      4 arrivals  81-102d   reported as 91.5
COS  | 2026-09-20 | Hong Kong > New York    3 arrivals   37-61d   reported as 47
```

A reader books "48 days" and may get 69. The old connection model exposed this through the range;
the option model trades it for a count that is not distorted by publishing volume. That is the right
trade for *comparing carriers* and the wrong one for *booking a specific sailing* — which is the
grid's job, and the grid still shows every connection.

**Worth fixing** by carrying an option's own min/max and flagging a wide one, rather than by
reverting to connection-weighted aggregates.

## 3. An option is what is ADVERTISED, not what is obtainable

The schedule is a carrier's published intent. Whether space exists on a given routing, and whether a
forwarder will actually quote it, are outside this dataset entirely. The view measures **choice on
paper**. Every number here is upstream of a phone call.

---

# Open Questions

**1. POD / Last CY exceptions — ANSWERED, differently.** The ~30-mile distance guard was not built.
The shipped answer is the explicit `COMPLEXES` list in `ports.ts`, because "same place" is a
commercial judgement about rail ramps and drayage markets rather than a distance. See View A.
*Remaining:* `Semarang → Semarang, Indonesia` is a naming variant, not a complex, and is still
flagged as a rail leg. That wants normalisation of Last CY, not a complex entry — see question 5.

**2. The 5-day window — ANSWERED.** Surface staleness per carrier, and read the query-time-guarded
`schedules_latest_secure` rather than the materialized view. Shipped as `scrapedByCarrier` and the
Scraped column. The window was not widened and no fallback to older snapshots was added: a stale
number presented as current is the worse failure.

**3. Minimum-sample thresholds — STILL OPEN, and now scoped differently.** ≥4 departures and ≥3
carriers were thresholds for View C, which is unbuilt. What shipped instead is the *thin service*
rule in `carrierStats`: a carrier with under a quarter of the best-served carrier's sail dates sorts
behind substantial ones, **unless** it is materially faster (≥10% of the lane median). Both
constants are reasonable rather than derived. Note they are visible in the **sort** rather than
hidden in a filter — nothing is dropped, only ordered, which is the right default for a view whose
output is a rate request rather than a booking.

**4. `Xiaochan Beach`** — verify what port this actually is before drawing a line through it. Moot
until the map exists.

**5. NEW — Last CY naming variants split lanes.** `canonicalPort` folds port *complexes*, but there
is no general normalisation of Last CY spellings, and `lanesIn` keys on the folded raw value. So
`Cartagena, Colombia → Cincinnati, OH` and `Cartagena, Colombia → Cincinnati` are one commercial
lane appearing as two entries — splitting the very picture View A exists to give, and quietly
shrinking both halves.

This is the Counting Rules normalisation requirement applied to **Last CY** rather than to
transshipment ports, and it has the same character: it would not look broken, it would look
plausible and be wrong. It is a prerequisite for the lane picker being trustworthy, and it is
cheaper than the corridor-fragmentation case because the fix is one resolver rather than a
re-keying.
