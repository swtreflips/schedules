import { useMemo, useState } from "react";
import { useMarketSnapshot } from "../../state/useMarketSnapshot";
import { carrierStats, corridorStats, lanesIn, type Lane } from "../../lib/analytics/lane";
import type { Spread } from "../../lib/analytics/departures";

/**
 * Analytics — the layer above the grid.
 *
 * The grid ranks candidates so a booking can be made today. This shows the routing shapes that
 * exist on a lane, which carriers run them, and who is actually fast — the context that says
 * whether today's best option is good or merely the best of a bad set.
 *
 * Deliberately its own fetch and its own scope: the grid's CRD and POD filters do NOT apply here,
 * and the header says so, because two views that silently disagree are worse than one.
 */

const fmt = (n: number | null) => (n == null ? "—" : String(n));

/** Never an average without its range — a median alone hides the thing worth seeing. */
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

export function AnalyticsView() {
  const { rows, snapshotAt, scrapedByCarrier, loading, error } = useMarketSnapshot();
  const [laneKey, setLaneKey] = useState<string | null>(null);

  const lanes = useMemo(() => lanesIn(rows), [rows]);
  const lane: Lane | undefined = useMemo(() => {
    if (!lanes.length) return undefined;
    const found = lanes.find((l) => `${l.pol} → ${l.lastCy}` === laneKey);
    return found ?? lanes[0];
  }, [lanes, laneKey]);

  const corridors = useMemo(() => (lane ? corridorStats(rows, lane) : []), [rows, lane]);
  const carriers = useMemo(() => (lane ? carrierStats(rows, lane) : []), [rows, lane]);

  if (loading) return <div className="an-state">Loading market…</div>;
  if (error) return <div className="an-state an-error">Could not load analytics — {error}</div>;
  if (!lane) return <div className="an-state">No sailings in the current snapshot.</div>;

  const totalConns = corridors.reduce((n, c) => n + c.departures, 0);

  return (
    <div className="an-root">
      <div className="an-head">
        <label className="an-lane">
          <span className="eyebrow">Lane</span>
          <select
            value={`${lane.pol} → ${lane.lastCy}`}
            onChange={(e) => setLaneKey(e.target.value)}
          >
            {lanes.map((l) => (
              <option key={`${l.pol} → ${l.lastCy}`} value={`${l.pol} → ${l.lastCy}`}>
                {l.pol} → {l.lastCy} ({l.departures})
              </option>
            ))}
          </select>
        </label>
        <span className="an-meta">
          {totalConns} connections · {carriers.length} carriers · {corridors.length} corridors
          {snapshotAt && <> · snapshot {snapshotAt.slice(0, 10)}</>}
        </span>
        {/* The grid's filters do not reach this view. Saying so is cheaper than the confusion. */}
        <span className="an-meta an-dim">whole current market — not filtered by the search above</span>
      </div>

      <div className="an-scroll">
        <section className="an-section">
          <h3 className="eyebrow">Corridors — how this lane is actually sailed</h3>
          <table className="an-table">
            <thead>
              <tr>
                <th>Via</th>
                <th>Discharge</th>
                <th className="an-num">TS</th>
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
                    {/* An inland Last CY is reached by rail from the POD, and WHICH port decides
                        how long that takes: Salt Lake City runs 31 days via Long Beach and 77 via
                        Houston. Marking the rail leg keeps that visible. */}
                    {c.hasRailLeg && <span className="an-rail" title="rail leg from this port"> +rail</span>}
                  </td>
                  <td className="an-num">{c.ts}</td>
                  <td className="an-num">{c.departures}</td>
                  <td className="an-carriers">{c.carriers.join(" ")}</td>
                  <SpreadCell s={c.transit} />
                  <td>{c.nextEtd?.slice(0, 10) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="an-section">
          <h3 className="eyebrow">Carriers — who is good at this lane</h3>
          <table className="an-table">
            <thead>
              <tr>
                <th>Carrier</th>
                <th className="an-num">Conns</th>
                <th className="an-num">Corridors</th>
                <th className="an-num">Direct</th>
                <th className="an-num">1 TS</th>
                <th className="an-num">2+ TS</th>
                <th className="an-num">Transit — median / range</th>
                <th className="an-num">Spread</th>
                <th className="an-num">Avg gap</th>
                <th>Next ETD</th>
                <th>Scraped</th>
              </tr>
            </thead>
            <tbody>
              {carriers.map((r) => (
                <tr key={r.carrier}>
                  <td className="an-carrier">{r.carrier}</td>
                  <td className="an-num">{r.departures}</td>
                  <td className="an-num">{r.corridors}</td>
                  {/* NOT a bare 0. schedules_latest keeps only the newest snapshot per
                      (carrier, POL, last_cy), and WHL's published routing alternates between
                      snapshots — so "no direct" here can mean "not in this one" for a carrier with
                      35 direct departures in history. */}
                  <td className="an-num">
                    {r.directUnknown ? (
                      <span className="an-dim" title="No direct sailing in this snapshot. Not proof the carrier runs none — the view holds only the newest scrape per carrier and lane.">
                        none¹
                      </span>
                    ) : (
                      r.direct
                    )}
                  </td>
                  <td className="an-num">{r.ts1}</td>
                  <td className="an-num">{r.ts2plus}</td>
                  <SpreadCell s={r.transit} />
                  <td className="an-num">{fmt(r.transit.spread)}</td>
                  <td className="an-num">{r.avgGapDays == null ? "—" : `${r.avgGapDays}d`}</td>
                  <td>{r.nextEtd?.slice(0, 10) ?? "—"}</td>
                  <td className="an-dim">{scrapedByCarrier.get(r.carrier)?.slice(0, 10) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="an-foot">
            ¹ “none” means no direct sailing <em>in this snapshot</em>, not that the carrier runs
            none. Only the newest scrape per carrier and lane is kept, and published routings can
            change between scrapes.
          </p>
        </section>
      </div>
    </div>
  );
}
