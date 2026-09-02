import { useMemo, useState } from "react";
import { useMarketSnapshot } from "../../state/useMarketSnapshot";
import {
  carrierStats,
  corridorStats,
  lanesIn,
  type CarrierRow,
  type Lane,
} from "../../lib/analytics/lane";
import { laneVerdict } from "../../lib/analytics/rfq";
import { ReportButton } from "./ReportButton";
import type { Spread } from "../../lib/analytics/departures";

/**
 * Analytics — what this lane's market looks like, and who is doing well in it.
 *
 * The grid ranks sailings so a booking can be made today. This sits above it: which carriers are
 * worth asking a forwarder to quote, so we can name them instead of leaving the RFQ open.
 *
 * IT DOES NOT NAME THEM FOR YOU. The table is sorted so the answer is the top row — most direct
 * sailing dates, then the shallowest transshipments, then the transit its main service actually
 * delivers. A recommendation sentence would be faster to read and harder to trust; the ordering
 * makes the same case out of numbers the reader can check.
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

export function AnalyticsView() {
  const { rows, snapshotAt, scrapedByCarrier, loading, error } = useMarketSnapshot();
  const [laneKey, setLaneKey] = useState<string | null>(null);

  const lanes = useMemo(() => lanesIn(rows), [rows]);
  const lane: Lane | undefined = useMemo(() => {
    if (!lanes.length) return undefined;
    return lanes.find((l) => `${l.pol} → ${l.lastCy}` === laneKey) ?? lanes[0];
  }, [lanes, laneKey]);

  const carriers = useMemo(() => (lane ? carrierStats(rows, lane) : []), [rows, lane]);
  const corridors = useMemo(() => (lane ? corridorStats(rows, lane) : []), [rows, lane]);
  const verdict = useMemo(() => (lane ? laneVerdict(lane, carriers) : null), [lane, carriers]);

  if (loading) return <div className="an-state">Loading market…</div>;
  if (error) return <div className="an-state an-error">Could not load analytics — {error}</div>;
  if (!lane || !verdict) return <div className="an-state">No sailings in the current snapshot.</div>;

  return (
    <div className="an-root">
      <div className="an-head">
        <label className="an-lane">
          <span className="eyebrow">Lane</span>
          <select value={`${lane.pol} → ${lane.lastCy}`} onChange={(e) => setLaneKey(e.target.value)}>
            {lanes.map((l) => (
              <option key={`${l.pol} → ${l.lastCy}`} value={`${l.pol} → ${l.lastCy}`}>
                {l.pol} → {l.lastCy} ({l.departures})
              </option>
            ))}
          </select>
        </label>
        <span className="an-meta">
          {carriers.length} carriers · {corridors.length} corridors
          {snapshotAt && <> · snapshot {snapshotAt.slice(0, 10)}</>}
        </span>
        <span className="an-meta an-dim">whole current market — not filtered by the search above</span>
        <ReportButton rows={rows} snapshotAt={snapshotAt} />
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
                <th className="an-num" title="Sailing dates whose best option is direct">Direct</th>
                <th className="an-num" title="Sailing dates whose best option is one transshipment">1 TS</th>
                <th className="an-num" title="Sailing dates whose best option is two or more transshipments">2+ TS</th>
                <th className="an-num" title="Distinct departure dates. Direct + 1 TS + 2+ TS add up to this: each date is counted once, under its best routing.">Dates</th>
                <th className="an-num" title="Mean transshipments per sailing. Lower is a shorter, less fragile route.">Avg TS</th>
                <th title="The routing this carrier runs most often">Main service</th>
                <th className="an-num" title="Median transit of that main service — what is on offer repeatedly, not the best case">Its transit</th>
                <th className="an-num">All sailings — median / range</th>
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
                      c.directDates
                    )}
                  </td>
                  <td className="an-num">{c.ts1Dates || "—"}</td>
                  <td className="an-num">{c.ts2Dates || "—"}</td>
                  <td className="an-num an-strong">{c.sailDates}</td>
                  <td className="an-num an-strong">{c.avgTs.toFixed(2)}</td>
                  <td className="an-route">
                    {c.mainRoute ? (
                      <>
                        {c.mainRoute.label}
                        <span className="an-dim"> ×{c.mainRoute.connections}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="an-num an-strong">{fmt(c.mainRoute?.median ?? null)}</td>
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
            <strong>Its transit</strong> is the median of the service each carrier runs most, not
            its fastest sailing — a one-off quick crossing is not what gets booked repeatedly.
            <strong> Direct / 1 TS / 2+ TS</strong> count sailing DATES, each under its best
            routing that day, so the three add up to <strong>Dates</strong> — a carrier offering a
            1 TS and a 2 TS on one departure is counted once, as the 1 TS. <strong>Avg TS</strong>
            is where the deeper routings it also runs still show.
            <strong> Spread</strong> is what the median hides: the most-served carrier on a lane is
            often the least predictable, and a 27-day spread means the transit you were quoted is
            not the one you can count on. <strong>Sailing window</strong> separates a service that
            is small from one that is <em>ending</em>. <strong>Dates</strong> counts distinct
            departures, not connections: several onward vessels off one feeder are one chance to
            ship, not four. <strong>Direct</strong> reads “none” when this snapshot holds no direct
            sailing, which is not the same as the carrier running none.
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
                <th className="an-num">Dates</th>
                <th className="an-num">Conns</th>
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
                  <td className="an-num an-strong">{c.sailDates}</td>
                  <td className="an-num an-dim">{c.departures}</td>
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
