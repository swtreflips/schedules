import { useMemo } from "react";
import {
  carrierStats,
  corridorStats,
  type CarrierRow,
  type Lane,
} from "../../lib/analytics/lane";
import { LOCAL_DRAY_MILES, REGIONAL_DRAY_MILES } from "../../lib/analytics/drayage";
import { laneVerdict } from "../../lib/analytics/rfq";
import { useDrayage } from "../../state/useDrayage";
import { ReportButton } from "./ReportButton";
import type { Spread } from "../../lib/analytics/departures";
import type { Schedule } from "../../types/schedule";

/**
 * Analytics — how the market serves ONE DESTINATION, and who is worth asking.
 *
 * THE LANE IS POL -> THE CUSTOMER'S DOOR. Not POL -> Last CY, which is what this used to show.
 *
 * It is the same argument `lane.ts` already makes one level down, applied once more. That file
 * refuses to compare on discharge port, because "Last CY is where the customer's box actually ends
 * up; the discharge port is a routing choice made to get it there". But the box does not stop at
 * the Last CY either — it stops at a warehouse. A Gainesville, FL warehouse is served through
 * Jacksonville by the carriers that cover it, Savannah by others and Tampa by others again, and
 * splitting those into three screens hides that they are three answers to one question.
 *
 * So this reads the SEARCH, exactly as Plan and Rank do — `nearby_schedules` already returns every
 * Last CY inside the radius — and the Last CY becomes part of the routing rather than the frame.
 *
 * WHICH MEANS THE COMPARISON NEEDS THE GROUND LEG. Once the routings end in different places, ocean
 * transit alone compares different journeys: Jacksonville is 84 road miles from that warehouse and
 * Savannah is 210. Ranking is on DOOR transit, and the miles stay on the row because they are what
 * the ground move costs.
 *
 * The strict port-pair comparison did not go away — it moved behind "Generate report", where every
 * carrier ends in the same place and no drayage needs telling apart.
 */

const fmt = (n: number | null | undefined) => (n == null ? "—" : String(n));

/** Never a median without its range — the spread is what an average hides. */
function SpreadCell({ s }: { s: Spread }) {
  if (s.n === 0) return <td className="an-num an-dim">—</td>;
  return (
    <td className="an-num">
      <span className="an-median">{fmt(s.median)}</span>
      <span className="an-range">
        {fmt(s.min)}–{fmt(s.max)}
      </span>
      {s.n < s.of && (
        <span className="an-partial" title={`${s.of - s.n} of ${s.of} have no published transit`}>
          {s.n}/{s.of}
        </span>
      )}
    </td>
  );
}

/**
 * Every routing a carrier runs that is worth quoting — not just the busiest one.
 *
 * A CARRIER IS NOT ONE SERVICE. The first line here is exactly what the old "Main service" and
 * "Its transit" columns showed, so nothing is lost; the lines under it are what was being hidden.
 * On Laem Chabang -> Los Angeles/Long Beach, ZIM runs three routings at 23, 25 and 27.5 days
 * against a 26-day lane and the table used to name one of them.
 *
 * STACKED IN SERVICE ORDER — how often each routing runs, not how fast it is. A routing offered
 * fifteen times is a better description of a carrier than one offered twice, and the same reasoning
 * that makes "main service" the honest headline applies to the ones below it.
 */
const SERVICES_SHOWN = 3;

function ServicesCell({ c }: { c: CarrierRow }) {
  const usable = c.services.filter((s) => s.usable);
  const slower = c.services.filter((s) => !s.usable);
  const shown = usable.slice(0, SERVICES_SHOWN);
  const rest = usable.length - shown.length;

  // Spelled out rather than left blank, for the same reason Direct reads "none": an empty cell
  // looks like missing data, and "every routing this carrier runs is materially slower than the
  // lane" is a finding.
  const title = (list: typeof c.services) =>
    list
      .map(
        (s) =>
          `${s.label}${s.label.endsWith(s.lastCy) ? "" : ` → ${s.lastCy}`} ×${s.options} · ${fmt(s.median)}d` +
          (s.dray ? ` + ${s.dray.miles}mi dray from ${s.lastCy} = ${fmt(s.doorMedian)}d door` : ""),
      )
      .join("\n");

  return (
    <td className="an-services">
      {shown.length === 0 ? (
        <span className="an-dim">nothing within reach of the lane</span>
      ) : (
        shown.map((s) => (
          <span className="an-service" key={s.label + s.lastCy}>
            {s.label}
            {/* THE HAND-OVER POINT, when it is not the discharge port.
                Measured on Nhava Sheva -> Gainesville, HPL discharges at Savannah and carries the
                box to Tampa — 26 of 53 rows on that search are this shape. The mileage beside this
                line is measured from where the CUSTOMER takes over, so showing a chain ending
                "Savannah" next to Tampa's 137 miles reads as Savannah being 137 miles away. It is
                210. Naming both is the only honest way to put a ground leg on this row. */}
            {!s.label.endsWith(s.lastCy) && (
              <span className="an-service-cy" title="The carrier moves the box this far inland; your drayage starts here">
                {" → "}
                {s.lastCy}
              </span>
            )}
            <span className="an-dim" title={`${s.options} options across ${s.dates} sailing dates`}>
              {" "}×{s.options}
            </span>
            <span className="an-service-t">{fmt(s.median)}d</span>
            {/* The ground leg belongs on the ROUTING, not on the carrier: one carrier can reach
                Jacksonville and Savannah for the same warehouse, and those are the two numbers the
                reader is actually choosing between. */}
            {s.dray && (
              <span
                className="an-dim an-service-dray"
                title={`${s.lastCy} → the destination: ${s.dray.miles} road miles, ${s.dray.hours}h drive, counted as ${s.dray.days} day${s.dray.days === 1 ? "" : "s"}`}
              >
                {" "}· {s.dray.miles}mi
              </span>
            )}
          </span>
        ))
      )}
      {rest > 0 && (
        <span className="an-dim an-service-more" title={title(usable.slice(SERVICES_SHOWN))}>
          +{rest} more usable
        </span>
      )}
      {slower.length > 0 && (
        <span className="an-dim an-service-more" title={title(slower)}>
          +{slower.length} slower
        </span>
      )}
    </td>
  );
}

/** Signed days against the lane's median carrier. Faster reads as a gain, not a smaller number. */
function VsLane({ v }: { v: number | null }) {
  if (v == null) return <td className="an-num an-dim">—</td>;
  const cls = v < 0 ? "an-fast" : v > 0 ? "an-slow" : "an-dim";
  return (
    <td className={"an-num " + cls}>
      {v > 0 ? "+" : ""}
      {v}d
    </td>
  );
}

interface Props {
  /** The search result — one POL, every Last CY inside the radius. Already carrier/CRD filtered. */
  rows: Schedule[];
  /** What the user actually typed: the warehouse city. Empty until a search has run. */
  destination: string;
  pol: string;
  radiusMiles: number;
  searching: boolean;
}

export function AnalyticsView({ rows, destination, pol, radiusMiles, searching }: Props) {
  // Every place the box could be handed over, for one round-trip to the router.
  const lastCys = useMemo(
    () => [...new Set(rows.map((r) => r.last_cy).filter(Boolean))],
    [rows],
  );
  const { dray, loading: drayLoading, error: drayError } = useDrayage(lastCys, destination);

  // Freshness comes from the rows on screen rather than a separate market read: these ARE the rows
  // being analysed, so the date beside a carrier is the date of the data in front of you.
  const scrapedByCarrier = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) {
      const q = r.query_date;
      if (!q) continue;
      const prev = m.get(r.carrier_code);
      if (!prev || q > prev) m.set(r.carrier_code, q);
    }
    return m;
  }, [rows]);

  // NO LANE ARGUMENT. `inLane(rows, undefined)` returns the rows untouched, so the statistics run
  // over the whole search — every Last CY within the radius — rather than one port pair.
  const carriers = useMemo(() => carrierStats(rows, undefined, dray), [rows, dray]);
  const corridors = useMemo(() => corridorStats(rows), [rows]);

  const lane: Lane = useMemo(
    () => ({ pol, lastCy: destination, destination }),
    [pol, destination],
  );
  const verdict = useMemo(() => laneVerdict(lane, carriers), [lane, carriers]);

  if (searching) return <div className="an-state">Searching…</div>;
  if (!destination) {
    return (
      <div className="an-state">
        Search a load port and a final destination above to see how the market serves it.
      </div>
    );
  }
  if (!rows.length) {
    return (
      <div className="an-state">
        No sailings from {pol} within {radiusMiles} miles of {destination}. Widen the radius, or
        check the carrier filter and cargo-ready date.
      </div>
    );
  }

  return (
    <div className="an-root">
      <div className="an-head">
        <span className="an-lane-title">
          <span className="eyebrow">Serving</span>
          <strong>
            {pol} → {destination}
          </strong>
        </span>
        <span className="an-meta">
          {carriers.length} carriers · {lastCys.length} discharge option
          {lastCys.length === 1 ? "" : "s"} · within {radiusMiles} mi
        </span>
        {/* Said out loud: a door figure that is quietly missing its ground leg is worse than one
            that admits it, because the number still looks complete. */}
        {drayLoading && <span className="an-meta an-dim">measuring drayage…</span>}
        {drayError && (
          <span className="an-meta an-slow" title={drayError}>
            drayage unavailable — ranked on ocean transit only
          </span>
        )}
        <ReportButton />
      </div>

      <div className="an-scroll">
        {/* 1. What kind of market is this. A lane with no direct service must read as a hard
            market rather than as a broken screen — 10 of 51 lanes have none. */}
        <div className={"an-verdict an-verdict--" + verdict.tone}>
          <strong>{verdict.headline}</strong>
          <span>{verdict.detail}</span>
        </div>

        {/* 2. The evidence, ordered so the answer is the top row. */}
        <section className="an-section">
          <h3 className="eyebrow">Carriers — most direct first, then fewest transshipments</h3>
          <table className="an-table">
            <thead>
              <tr>
                <th>Carrier</th>
                <th className="an-num" title="Direct options">Direct</th>
                <th className="an-num" title="Options with one transshipment">1 TS</th>
                <th className="an-num" title="Options with two or more transshipments">2+ TS</th>
                <th className="an-num" title="Quotable options: one routing, on one day. Direct + 1 TS + 2+ TS always add up to this, because an option has exactly one routing depth.">Options</th>
                <th className="an-num" title="Days a box can actually leave on. Fewer than Options means several routings share a departure day.">Dates</th>
                <th className="an-num" title="Mean transshipments per option. Lower is a shorter, less fragile route.">Avg TS</th>
                <th title="Every routing this carrier runs that is within reach of the lane — each one is another chance at space. Busiest first, so the top line is the service it runs most. The mileage is that routing's ground leg to your destination.">Usable services</th>
                <th className="an-num" title="Ocean transit plus the ground leg — what the customer actually waits. This is what the table is ranked on, because the routings end in different ports.">Door</th>
                <th className="an-num" title="Ocean transit only — port of loading to the discharge that routing uses">Ocean — median / range</th>
                <th className="an-num" title="Slowest minus fastest. A wide spread means the transit you were quoted is not the one you can count on.">Spread</th>
                <th className="an-num" title="Against the lane's median carrier">vs lane</th>
                <th title="First and last published sailing. A service ending soon is thin in a different way from a small one.">Sailing window</th>
                <th title="When this carrier was last scraped">Scraped</th>
              </tr>
            </thead>
            <tbody>
              {carriers.map((c) => (
                <tr key={c.carrier}>
                  <td className="an-carrier">{c.carrier}</td>

                  {/* Not a bare 0 — the snapshot holds only the newest scrape per carrier and
                      lane, and a carrier's published routing can change between scrapes. */}
                  <td className="an-num">
                    {c.directUnknown ? (
                      <span
                        className="an-dim"
                        title="No direct sailing in this snapshot. Not proof the carrier runs none — only the newest scrape per carrier and lane is kept."
                      >
                        none
                      </span>
                    ) : (
                      c.directOptions
                    )}
                  </td>
                  <td className="an-num">{c.ts1Options || "—"}</td>
                  <td className="an-num">{c.ts2Options || "—"}</td>
                  <td className="an-num an-strong">{c.options}</td>
                  {/* Dimmer than Options: the secondary of the pair. Equal numbers mean one routing
                      per departure; fewer dates means a day carries several routings. */}
                  <td className="an-num an-dim">{c.sailDates}</td>
                  <td className="an-num an-strong">{c.avgTs.toFixed(2)}</td>
                  <ServicesCell c={c} />
                  {/* The ranked figure leads in weight; ocean sits beside it so the reader can see
                      which half of the journey each number came from. */}
                  <td className="an-num an-strong">
                    {c.door?.median == null ? (
                      <span className="an-dim" title="No ground leg resolved for this carrier's routings">
                        —
                      </span>
                    ) : (
                      `${c.door.median}d`
                    )}
                  </td>
                  <SpreadCell s={c.transit} />
                  {/* Its own column because it decides bookings and was unreadable inside the
                      range. On Semarang -> Savannah, HMM has the most sailings on the lane and a
                      27-day spread (38-65) against MSC's 10 (40-50): the most-served carrier is
                      also the least predictable, which the median alone conceals. */}
                  <td className={"an-num " + (c.transit.spread != null && c.transit.spread >= 20 ? "an-slow" : "")}>
                    {c.transit.spread == null ? "—" : `${c.transit.spread}d`}
                  </td>
                  <VsLane v={c.vsLaneMedian} />
                  <td className="an-window">
                    {c.nextEtd?.slice(5, 10) ?? "—"}
                    {c.lastEtd && c.lastEtd !== c.nextEtd && (
                      <span className="an-dim"> → {c.lastEtd.slice(5, 10)}</span>
                    )}
                  </td>
                  <td className="an-dim">{scrapedByCarrier.get(c.carrier)?.slice(0, 10) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="an-foot">
            An <strong>option</strong> is one routing on one day — what a forwarder actually quotes.
            A direct and a Taipei transship leaving the same day are two options: one may come back
            and the other not, and if both do you take the direct. Several onward vessels on the
            same routing are <em>one</em> option, not four.
            <strong> Options vs Dates</strong> — options are what you can ask for, dates are when
            you can leave. Equal numbers mean one routing per departure; fewer dates means a day
            carries several.
            <strong> Direct / 1 TS / 2+ TS</strong> always add up to <strong>Options</strong>,
            because an option has exactly one routing depth.
            <strong> Usable services</strong> lists every routing a carrier runs that lands within
            10% of the lane median — the same margin the table uses to decide a difference is worth
            acting on. A carrier is rarely one service, and a second acceptable routing is not a
            faster transit but <em>another chance at space</em>. The stack is ordered by how often
            each routing runs rather than how fast it is, which is why a lower line is sometimes the
            quicker one. <strong>+N slower</strong> is what did not clear the margin; hover it to
            see what and by how much.
            <strong> Door</strong> is ocean transit plus the ground leg, and it is what the table is
            ranked on. It has to be: your carriers do not all end in the same port, so comparing
            ocean legs alone compares different journeys. The mileage beside each routing is the
            road distance from that discharge point to your destination — a ground leg up to{" "}
            {LOCAL_DRAY_MILES} miles counts as one day, up to {REGIONAL_DRAY_MILES} as two, beyond
            that as three, because past local range a dray stops being a same-day turn. Those bands
            are a judgement about how the move runs, not a measurement; the miles are the
            measurement, and they are what the ground leg <em>costs</em>.
            <strong> Spread</strong> is what the median hides: the most-served carrier on a lane is
            often the least predictable, and a 27-day spread means the transit you were quoted is
            not the one you can count on. <strong>Sailing window</strong> separates a service that
            is small from one that is <em>ending</em>. <strong>Direct</strong> reads “none” when
            this snapshot holds no direct sailing, which is not the same as the carrier running
            none.
          </p>
        </section>

        {/* 4. Once a carrier is chosen: via where, and out of which port. */}
        <section className="an-section">
          <h3 className="eyebrow">Corridors — how this lane is sailed</h3>
          <table className="an-table">
            <thead>
              <tr>
                <th>Via</th>
                <th>Discharge</th>
                <th className="an-num">TS</th>
                <th className="an-num" title="Quotable options on this routing. More than Dates when two carriers sail it on the same day.">Options</th>
                <th className="an-num" title="Days this routing departs on">Dates</th>
                <th>Carriers</th>
                <th className="an-num">Transit — median / range</th>
                <th>Next ETD</th>
              </tr>
            </thead>
            <tbody>
              {corridors.map((c) => (
                <tr key={c.key}>
                  <td>{c.via.length ? c.via.join(" → ") : <em>direct</em>}</td>
                  <td>
                    {c.pod}
                    {c.hasRailLeg && (
                      <span className="an-rail" title="rail leg from this port to the destination">
                        {" "}
                        +rail
                      </span>
                    )}
                  </td>
                  <td className="an-num">{c.ts}</td>
                  <td className="an-num an-strong">{c.options}</td>
                  <td className="an-num an-dim">{c.sailDates}</td>
                  <td className="an-carriers">{c.carriers.join(" ")}</td>
                  <SpreadCell s={c.transit} />
                  <td>{c.nextEtd?.slice(0, 10) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

export type { CarrierRow };
