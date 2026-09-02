import { useMemo, useState } from "react";
import { useMarketSnapshot } from "../../state/useMarketSnapshot";
import {
  CHANCE_WEIGHTS,
  carrierStats,
  corridorStats,
  lanesIn,
  type CarrierRow,
  type Lane,
} from "../../lib/analytics/lane";
import { avoidReason, laneVerdict, shortlist } from "../../lib/analytics/rfq";
import type { Spread } from "../../lib/analytics/departures";

/**
 * Analytics — who to ask for rates on this lane.
 *
 * The grid ranks sailings so a booking can be made today. This sits above it and answers the
 * procurement question: we quote openly now, and we would rather tell a forwarder "quote HMM and
 * WHL" than leave it open, because naming the carriers whose space is most likely to be secured
 * puts us in better standing before the booking exists.
 *
 * Ordered for a glance: what kind of market this is, who to ask, then the evidence.
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

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="an-copy"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1600);
          },
          () => setDone(false),
        );
      }}
    >
      {done ? "copied" : "copy"}
    </button>
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
  const rfq = useMemo(() => (lane ? shortlist(lane, carriers) : null), [lane, carriers]);

  if (loading) return <div className="an-state">Loading market…</div>;
  if (error) return <div className="an-state an-error">Could not load analytics — {error}</div>;
  if (!lane || !verdict || !rfq) return <div className="an-state">No sailings in the current snapshot.</div>;

  const avoid = carriers.filter((c) => c.tier === "avoid");

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
      </div>

      <div className="an-scroll">
        {/* 1. What kind of market is this. A lane with no direct service must read as a hard
            market rather than as a broken screen — 10 of 51 lanes have none. */}
        <div className={"an-verdict an-verdict--" + verdict.tone}>
          <strong>{verdict.headline}</strong>
          <span>{verdict.detail}</span>
        </div>

        {/* 2. The decision. This is why the view exists: it gets pasted into an email. */}
        <section className="an-rfq">
          <div className="an-rfq__top">
            <span className="eyebrow">Ask forwarders to quote</span>
            <CopyButton text={rfq.sentence} />
          </div>
          <p className="an-rfq__line">{rfq.sentence}</p>
          {rfq.reasons.length > 0 && (
            <ul className="an-rfq__why">
              {rfq.reasons.map((r) => (
                <li key={r.carrier}>
                  <span className="an-carrier">{r.carrier}</span> — {r.because}
                </li>
              ))}
            </ul>
          )}
          {avoid.length > 0 && (
            <ul className="an-rfq__avoid">
              {avoid.map((c) => (
                <li key={c.carrier}>
                  <span className="an-carrier">{c.carrier}</span> — {avoidReason(c, carriers.length)}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 3. The evidence behind the tier, every component visible so it can be argued with. */}
        <section className="an-section">
          <h3 className="eyebrow">
            Carriers — ranked by chances of securing space
            <span className="an-weights">
              {" "}
              chances = {CHANCE_WEIGHTS.direct}×direct + {CHANCE_WEIGHTS.ts1}×1TS +{" "}
              {CHANCE_WEIGHTS.ts2plus}×2TS+ sailing dates
            </span>
          </h3>
          <table className="an-table">
            <thead>
              <tr>
                <th>Carrier</th>
                <th className="an-num" title="Weighted sailing dates">Chances</th>
                <th className="an-num" title="Distinct ETD dates — times you can actually ship">Dates</th>
                <th className="an-num">Direct</th>
                <th className="an-num">1 TS</th>
                <th className="an-num">2+ TS</th>
                <th className="an-num" title="Days from first to last sailing">Window</th>
                <th className="an-num">Avg gap</th>
                <th className="an-num">Transit — median / range</th>
                <th className="an-num" title="Against the lane's median carrier">vs lane</th>
                <th>Next ETD</th>
                <th title="When this carrier was last scraped">Scraped</th>
              </tr>
            </thead>
            <tbody>
              {carriers.map((c) => (
                <tr key={c.carrier} className={"an-tier an-tier--" + c.tier}>
                  <td className="an-carrier">
                    {c.carrier}
                    <span className="an-tierlabel">{c.tier}</span>
                  </td>
                  <td className="an-num an-strong">{c.chances}</td>
                  <td className="an-num an-strong">{c.sailDates}</td>
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
                  <td className="an-num">{c.windowDays ? `${c.windowDays}d` : "—"}</td>
                  <td className="an-num">{c.avgGapDays == null ? "—" : `${c.avgGapDays}d`}</td>
                  <SpreadCell s={c.transit} />
                  <VsLane v={c.vsLaneMedian} />
                  <td>{c.nextEtd?.slice(0, 10) ?? "—"}</td>
                  <td className="an-dim">{scrapedByCarrier.get(c.carrier)?.slice(0, 10) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="an-foot">
            <strong>Dates, not sailings.</strong> A carrier can publish many connections against a
            handful of departures — several onward vessels off one feeder. <em>Dates</em> is how
            many times a box can actually leave, which is what decides whether a forwarder can find
            space. <strong>Direct</strong> shows “none” when this snapshot has no direct sailing,
            which is not the same as the carrier running none.
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
