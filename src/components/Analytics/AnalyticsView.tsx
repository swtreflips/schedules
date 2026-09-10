import {
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  carrierStats,
  corridorStats,
  type CarrierRow,
  type Lane,
  type Service,
} from "../../lib/analytics/lane";
import { canonicalPort } from "../../lib/analytics/ports";
import { laneVerdict } from "../../lib/analytics/rfq";
import { useDrayage } from "../../state/useDrayage";
import { PodFilterPopover } from "../SchedulesGrid/PodFilterPopover";
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
 * THE GROUND LEG IS SHOWN, NOT SCORED. Once the routings end in different places the reader needs to
 * know what is left to solve — Jacksonville is 84 road miles from that warehouse and Savannah is
 * 210, and that is a real cost. But it is a leg the shipper arranges, not one the carrier is
 * answerable for, so it sits in its own column and touches nothing else. Ranking, `vs lane` and the
 * usable test are all ocean transit.
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

/**
 * Which routings a row shows, decided once and read by three columns.
 *
 * MAIN SERVICES, SERVICE MEDIAN AND DRAYAGE DISTANCE ARE ONE TABLE TURNED SIDEWAYS. Each is a stack
 * of the same routings in the same order, so line 2 of Service median is the median of line 2 of
 * Main services. A single figure per carrier could not do that — a carrier running Jacksonville at
 * 84 miles and Savannah at 210 has no one drayage — and a range would say "somewhere between these"
 * where the row can simply say which is which.
 *
 * The alignment holds because `.an-service` is `nowrap`: a long routing name scrolls the table
 * rather than wrapping, so the stacks cannot drift out of step.
 *
 * A CARRIER ALWAYS NAMES WHAT IT RUNS, even when none of it clears the margin. This used to render
 * "nothing within reach of the lane" and stop. On Cartagena -> Seymour, IN that produced an HMM row
 * carrying 2 options, a 27.5-day median, a spread and a sailing window beside an empty cell — while
 * Rank plainly listed its two Cincinnati sailings. It read as broken data, and was reported as a
 * bug, correctly. The fallback shows the best routing anyway, dimmed and labelled; the
 * classification does not move, only the silence.
 */
function shownServices(c: CarrierRow) {
  const usable = c.services.filter((s) => s.usable);
  const slower = c.services.filter((s) => !s.usable);
  return {
    usable,
    slower,
    shown: usable.length ? usable.slice(0, SERVICES_SHOWN) : slower.slice(0, 1),
    rest: usable.length ? usable.length - usable.slice(0, SERVICES_SHOWN).length : 0,
    outOfReach: usable.length === 0,
  };
}

/**
 * One stacked column of the service block — a cell that renders one line per routing shown.
 *
 * FIVE COLUMNS ARE ONE TABLE TURNED SIDEWAYS: POD, TS chain and Last CY under a spanning "Main
 * services" label, then Service median and Drayage distance. Each stacks the same routings in the
 * same order, so a row of the stack reads across as one routing. Splitting the routing into three
 * columns is what makes it skimmable — "Singapore, Singapore > Shanghai, China > Los Angeles/Long
 * Beach, CA → Tampa, FL ×5" is three separate facts wearing one string, and the eye cannot compare
 * discharge ports down a column when they sit at a different offset on every line.
 *
 * The alignment holds because `.an-service` is `nowrap` and every cell renders from the same
 * `shownServices(c)`, so the stacks cannot differ in length or drift out of step.
 */
function StackedCell({
  c,
  render,
  className = "",
  title,
}: {
  c: CarrierRow;
  render: (s: Service) => ReactNode;
  className?: string;
  title?: (s: Service) => string;
}) {
  const { shown, outOfReach } = shownServices(c);
  if (!shown.length) return <td className={`${className} an-dim`}>—</td>;
  return (
    <td className={`${className} an-services${outOfReach ? " an-service--far" : ""}`}>
      {shown.map((s) => (
        <span className="an-service" key={s.label + s.lastCy} title={title?.(s)}>
          {render(s)}
        </span>
      ))}
    </td>
  );
}

/** The hand-offs, in order. A direct sailing says so rather than leaving the cell blank. */
const ViaCell = ({ c }: { c: CarrierRow }) => (
  <StackedCell
    c={c}
    render={(s) =>
      s.via.length ? s.via.join(" > ") : <span className="an-dim">direct</span>
    }
    title={(s) =>
      s.via.length
        ? `${s.via.length} transshipment${s.via.length === 1 ? "" : "s"}: ${s.via.join(" → ")}`
        : "No transshipment — one vessel from load port to discharge"
    }
  />
);

/** Where the box comes off the ship. */
const PodCell = ({ c }: { c: CarrierRow }) => (
  <StackedCell c={c} className="an-group-start" render={(s) => s.discharge} />
);

/**
 * Where the carrier hands over — and the reason this is not the same column as POD.
 *
 * Measured on Nhava Sheva -> Gainesville, HPL discharges at Savannah and carries the box on to
 * Tampa: 26 of the 53 rows that search returns are that shape, and the drayage beside it is Tampa's
 * 137 miles rather than Savannah's 210. When the two are the same place the box does not move
 * inland at all, so it reads quietly.
 */
const LastCyCell = ({ c }: { c: CarrierRow }) => (
  <StackedCell
    c={c}
    render={(s) =>
      s.railLeg ? (
        <>
          <span
            className="an-service-cy"
            title="The carrier moves the box this far inland after discharging; your drayage starts here"
          >
            {s.lastCy}
          </span>
          {/* Named on the row, because it is why this routing sits below the water ones. */}
          <span
            className="an-rail"
            title={`Inland from ${s.discharge} — a different network and a different move`}
          >
            {" "}rail
          </span>
        </>
      ) : (
        <span className="an-dim" title="No inland move — the carrier hands over where the box comes off the ship">
          same as POD
        </span>
      )
    }
  />
);

/** How often each routing runs, plus the tail that describes the stack as a whole. */
function OptionsCell({ c }: { c: CarrierRow }) {
  const { shown, rest, usable, slower, outOfReach } = shownServices(c);

  const title = (list: Service[]) =>
    list
      .map(
        (s) =>
          `${s.label}${s.lastCy === s.discharge ? "" : ` → ${s.lastCy}`} ×${s.options} · ${fmt(s.median)}d` +
          (s.dray ? ` + ${s.dray.miles}mi dray from ${s.lastCy} = ${fmt(s.doorMedian)}d door` : ""),
      )
      .join("\n");

  return (
    <td className={"an-num an-services" + (outOfReach ? " an-service--far" : "")}>
      {shown.length === 0 ? (
        <span className="an-dim">no published routing</span>
      ) : (
        shown.map((s) => (
          <span
            className="an-service"
            key={s.label + s.lastCy}
            title={`${s.options} options across ${s.dates} sailing dates`}
          >
            ×{s.options}
          </span>
        ))
      )}
      {rest > 0 && (
        <span className="an-dim an-service-more" title={title(usable.slice(SERVICES_SHOWN))}>
          +{rest} more
        </span>
      )}
      {/* Why the lines above are greyed out, stated here rather than left to be inferred from the
          vs-lane column several cells away. */}
      {outOfReach && shown.length > 0 && (
        <span className="an-slow an-service-more">
          out of reach
          {c.vsLaneMedian != null && ` ${c.vsLaneMedian > 0 ? "+" : ""}${c.vsLaneMedian}d`}
        </span>
      )}
      {!outOfReach && slower.length > 0 && (
        <span className="an-dim an-service-more" title={title(slower)}>
          +{slower.length} slower
        </span>
      )}
    </td>
  );
}

/** Each routing's own ocean median. */
const ServiceMedianCell = ({ c }: { c: CarrierRow }) => (
  <StackedCell c={c} className="an-num an-group-end" render={(s) => `${fmt(s.median)}${s.median == null ? "" : "d"}`} />
);

/** Each routing's ground leg, measured from its Last CY. */
const DrayageCell = ({ c }: { c: CarrierRow }) => (
  <StackedCell
    c={c}
    className="an-num"
    render={(s) => (s.dray ? `${s.dray.miles} mi` : <span className="an-dim">—</span>)}
    title={(s) =>
      s.dray
        ? `${s.dray.from ?? s.lastCy} → the destination: ${s.dray.miles} mi, ${s.dray.hours}h drive`
        : "No ground leg resolved for this routing"
    }
  />
);

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
  /**
   * Every discharge port the search returned, BEFORE filtering — so a port that has been switched
   * off can still be switched back on. Raw names, as published.
   */
  availablePods: string[];
  excludedPods: Set<string>;
  onExcludedPodsChange: Dispatch<SetStateAction<Set<string>>>;
}

export function AnalyticsView({
  rows,
  destination,
  pol,
  radiusMiles,
  searching,
  availablePods,
  excludedPods,
  onExcludedPodsChange,
}: Props) {
  const [podAnchor, setPodAnchor] = useState<DOMRect | null>(null);
  const podTrigger = useRef<HTMLButtonElement>(null);

  /**
   * The filter lists what the COLUMN shows, which is the folded name, while `excludedPods` keys on
   * the berth as published — the same set Plan and Rank write, so switching a port off in one view
   * switches it off in all three.
   *
   * Those two are not the same string for a complex: the column reads `Los Angeles/Long Beach, CA`
   * where the rows carry `Los Angeles, CA` and `Long Beach, CA`. Listing raw names here would show
   * two entries for a port the table draws as one. So the list is folded and a toggle writes
   * through to every berth underneath it.
   */
  const podGroups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of availablePods) {
      const key = canonicalPort(p);
      const bucket = m.get(key);
      if (bucket) bucket.push(p);
      else m.set(key, [p]);
    }
    return m;
  }, [availablePods]);

  const podOptions = useMemo(() => [...podGroups.keys()].sort(), [podGroups]);

  // Excluded only when every berth under it is. A half-excluded complex reads as available, and
  // toggling it then switches the whole thing off — which is what the single checkbox promises.
  const excludedGroups = useMemo(() => {
    const out = new Set<string>();
    for (const [key, members] of podGroups) {
      if (members.every((m) => excludedPods.has(m))) out.add(key);
    }
    return out;
  }, [podGroups, excludedPods]);

  const togglePodGroup = (key: string) => {
    const members = podGroups.get(key) ?? [];
    onExcludedPodsChange((prev) => {
      const next = new Set(prev);
      const allOff = members.every((m) => next.has(m));
      for (const m of members) {
        if (allOff) next.delete(m);
        else next.add(m);
      }
      return next;
    });
  };

  // Every place the box could be handed over, for one round-trip to the router.
  const lastCys = useMemo(
    () => [...new Set(rows.map((r) => r.last_cy).filter(Boolean))],
    [rows],
  );
  const {
    dray,
    requested: drayRequested,
    loading: drayLoading,
    error: drayError,
  } = useDrayage(lastCys, destination);

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
  //
  // The dray map is display-only — `carrierStats` ranks on ocean transit whether it is passed or
  // not — so an empty one is harmless now. Still skipped when nothing resolved, to save the work.
  const carriers = useMemo(
    () => carrierStats(rows, undefined, dray.size ? dray : undefined),
    [rows, dray],
  );
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
        {/* Both of these are now true statements rather than hopeful ones: with no legs resolved the
            table really does fall back to the ocean ranking. */}
        {!drayLoading && drayRequested > 0 && dray.size < drayRequested && (
          <span className="an-meta an-slow" title={drayError ?? undefined}>
            {drayRequested - dray.size} of {drayRequested} discharge point
            {drayRequested === 1 ? "" : "s"} have no road distance
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
              {/* TWO HEADER ROWS. The routing is three separate facts — where it transships, where
                  it discharges, where the carrier hands over — and one string carrying all three
                  cannot be compared down a column, because every line puts them at a different
                  offset. Split into their own columns the discharge ports line up under each other,
                  which is the comparison the table exists for. They keep one heading because they
                  are still one thing: the services this carrier runs. */}
              {/* EVERY COLUMN HEADER SITS ON ONE LINE. The row above carries nothing but the group
                  label, floating over the four columns it covers — spanning the rest with empty,
                  border-less cells rather than stretching the real headings across two rows, which
                  centred them against the sub-heads and left the header looking lopsided. */}
              <tr className="an-grouprow">
                <th className="an-spacer" colSpan={7} />
                <th className="an-group" colSpan={4} title="Every routing this carrier runs that is within reach of the lane — each one is another chance at space. Busiest first, so the top line is the service it runs most.">
                  Main services
                </th>
                <th className="an-spacer" colSpan={7} />
              </tr>
              <tr>
                <th>Carrier</th>
                <th className="an-num" title="Direct options">Direct</th>
                <th className="an-num" title="Options with one transshipment">1 TS</th>
                <th className="an-num" title="Options with two or more transshipments">2+ TS</th>
                <th className="an-num" title="Quotable options: one routing, on one day. Direct + 1 TS + 2+ TS always add up to this, because an option has exactly one routing depth.">Options</th>
                <th className="an-num" title="Days a box can actually leave on. Fewer than Options means several routings share a departure day.">Dates</th>
                <th className="an-num" title="Mean transshipments per option. Lower is a shorter, less fragile route.">Avg TS</th>
                {/* The same filter Plan and Rank carry, writing the same `excludedPods` set — so
                    switching a discharge port off here switches it off everywhere. It is the answer
                    to a carrier publishing rail variants you would rather not look at: turn off New
                    York and the cross-country routings leave the table, without the analytics ever
                    deciding for you that they do not count. */}
                <th className="an-group-start">
                  <button
                    ref={podTrigger}
                    type="button"
                    className={"pod-header" + (excludedGroups.size ? " pod-header--active" : "")}
                    disabled={!podOptions.length}
                    aria-haspopup="dialog"
                    title="Filter by Port of Discharge — the same filter as Plan and Rank"
                    onClick={() =>
                      setPodAnchor((a) =>
                        a ? null : (podTrigger.current?.getBoundingClientRect() ?? null),
                      )
                    }
                  >
                    <span>POD</span>
                    {excludedGroups.size > 0 && (
                      <span className="pod-header__count">
                        {podOptions.length - excludedGroups.size}/{podOptions.length}
                      </span>
                    )}
                    {podOptions.length > 0 && (
                      <span className="pod-header__caret" aria-hidden>
                        ▾
                      </span>
                    )}
                  </button>
                </th>
                <th title="The hand-offs, in order, before that discharge. Reads “direct” when the box stays on one ship the whole way.">TS chain</th>
                <th title="Where the carrier's responsibility ends and your drayage starts. Often the discharge port; when it is not, the carrier is moving the box inland for you.">Last CY</th>
                <th className="an-num" title="Options on that routing — one routing, on one day">Options</th>
                <th className="an-num an-group-end" title="Each routing's own median transit, lined up with the routing beside it. Not the same as the carrier's overall median two columns right — a carrier running three routings has three of these.">Service median</th>
                <th className="an-num" title="Road miles from where each routing hands the box over to your destination — measured from the Last CY, which is not always the discharge port.">Drayage distance</th>
                <th className="an-num" title="Ocean transit only — port of loading to the discharge that routing uses. Across every option this carrier offers, so it describes the carrier rather than any one routing.">Ocean — median / range</th>
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
                  <PodCell c={c} />
                  <ViaCell c={c} />
                  <LastCyCell c={c} />
                  <OptionsCell c={c} />
                  <ServiceMedianCell c={c} />
                  <DrayageCell c={c} />
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
            <strong> Main services</strong>, <strong>Service median</strong> and{" "}
            <strong>Drayage distance</strong> are one table turned sideways: they stack the same
            routings in the same order, so the second line of each belongs to the second routing. A
            carrier is rarely one service, and a second acceptable routing is not a faster transit
            but <em>another chance at space</em>. <strong>Routings that stay on the water to the
            hand-over point come first</strong> — a carrier discharging at New York and railing to
            Los Angeles is a genuine option, and on a full week it is the answer, but it is not the
            one you reach for, so it sits below even a transshipped routing that ends where it
            discharges. Those are marked <em>rail</em> under Last CY. Under that, the stack is
            ordered by how often each routing runs rather than how fast it is, which is why a lower
            line is sometimes the quicker one.
            A routing qualifies when it lands within 10% of the lane — the same margin the table
            uses everywhere to decide a difference is worth acting on; <strong>+N slower</strong> is
            what did not, and a carrier with nothing inside the margin still shows its best routing,
            greyed and marked <em>out of reach</em>.
            <strong> Service median</strong> is per routing. The <strong>Ocean</strong> column beside
            it is per <em>carrier</em>, across everything it runs, so the two agree only when a
            carrier has one service.
            <strong> Drayage distance</strong> is measured from where the carrier hands the box over
            — the Last CY, which is not always the discharge port, so a routing reading{" "}
            <em>Savannah → Tampa</em> is drayed from Tampa, and a folded complex like{" "}
            <em>Los Angeles/Long Beach</em> is measured from whichever berth is nearer.{" "}
            <strong>It is context, not comparison.</strong> It says what is left to solve once the
            carrier has finished — a cost and a piece of planning on a leg you arrange — so it plays
            no part in the ranking, in <strong>vs lane</strong>, or in which routings count as
            usable. Those are all ocean transit, which is what the carrier is answerable for.
            Weigh the two yourself: a day of sailing can be worth several hundred ground miles.
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

      {/* Portalled to the body by the popover itself, so the table's own scrolling cannot clip it. */}
      {podAnchor && (
        <PodFilterPopover
          available={podOptions}
          excluded={excludedGroups}
          anchor={podAnchor}
          onTogglePod={togglePodGroup}
          onSelectAll={() => onExcludedPodsChange(new Set())}
          onSelectNone={() => onExcludedPodsChange(new Set(availablePods))}
          onClose={() => setPodAnchor(null)}
        />
      )}
    </div>
  );
}

export type { CarrierRow };
