import type { CarrierRow, Lane } from "./lane";

/**
 * Turning the lane picture into the thing the team actually does with it.
 *
 * We quote openly today. The point of this view is to be able to say "rates for Semarang → Los
 * Angeles, and please quote HMM and WHL" — naming the carriers whose space a forwarder is most
 * likely to secure, before the booking exists.
 */

export interface Verdict {
  tone: "healthy" | "mixed" | "tough";
  headline: string;
  detail: string;
}

/**
 * One sentence on the market's character.
 *
 * A lane with no direct service has to READ as a hard market rather than as a broken screen —
 * measured, 10 of the 51 lanes in the current snapshot have no direct sailing at all, and direct
 * is only 19% of connections market-wide. Silence there would look like a bug and get the whole
 * view distrusted.
 */
export function laneVerdict(lane: Lane, carriers: CarrierRow[]): Verdict {
  if (!carriers.length) {
    return {
      tone: "tough",
      headline: "No service in this snapshot",
      detail: `Nothing published for ${lane.pol} → ${lane.lastCy} in the current window.`,
    };
  }

  const withDirect = carriers.filter((c) => c.directDates > 0);
  const directDates = carriers.reduce((n, c) => n + c.directDates, 0);
  const allDates = carriers.reduce((n, c) => n + c.sailDates, 0);
  const pctDirect = allDates ? Math.round((directDates / allDates) * 100) : 0;

  const fastest = [...carriers]
    .filter((c) => c.transit.median != null)
    .sort((a, b) => (a.transit.median ?? 0) - (b.transit.median ?? 0))[0];
  const best = fastest
    ? `Best median ${fastest.transit.median} days (${fastest.carrier}).`
    : "No published transit times.";

  if (!withDirect.length) {
    return {
      tone: "tough",
      headline: "Tough lane — no direct service from any carrier",
      detail: `All ${carriers.length} carriers transship. ${best} Expect to trade transit for space.`,
    };
  }
  if (pctDirect >= 50) {
    return {
      tone: "healthy",
      headline: `Healthy — ${pctDirect}% of sailing dates are direct`,
      detail: `${withDirect.length} of ${carriers.length} carriers run direct. ${best}`,
    };
  }
  return {
    tone: "mixed",
    headline: `Mixed — ${pctDirect}% of sailing dates are direct`,
    detail: `Only ${withDirect.length} of ${carriers.length} carriers run direct. ${best}`,
  };
}

export interface Shortlist {
  carriers: CarrierRow[];
  /** Ready to paste into an email to a forwarder. */
  sentence: string;
  /** One clause per carrier saying why it is on the list. */
  reasons: Array<{ carrier: string; because: string }>;
}

/**
 * Who to name in the RFQ.
 *
 * Preferred carriers only, and NOT padded to a fixed three. A thin lane may honestly support one
 * or two; adding a third to fill the slot recommends a carrier the data does not support, which
 * is exactly the mistake this view exists to stop.
 */
export function shortlist(lane: Lane, carriers: CarrierRow[], max = 3): Shortlist {
  const picked = carriers.filter((c) => c.tier === "preferred").slice(0, max);

  const reasons = picked.map((c) => ({
    carrier: c.carrier,
    because: describe(c),
  }));

  const names = picked.map((c) => c.carrier);
  const sentence = names.length
    ? `Rates for ${lane.pol} → ${lane.lastCy} — please quote ${list(names)}.`
    : `Rates for ${lane.pol} → ${lane.lastCy} — open quote; no carrier stands out on schedule.`;

  return { carriers: picked, sentence, reasons };
}

/** Why this carrier earned the slot, in the terms the tier was decided on. */
function describe(c: CarrierRow): string {
  const parts: string[] = [];

  if (c.directDates > 0) {
    parts.push(`${c.directDates} direct sailing date${c.directDates === 1 ? "" : "s"}`);
  } else if (c.ts1Dates > 0) {
    parts.push(`${c.ts1Dates} single-transship date${c.ts1Dates === 1 ? "" : "s"}`);
  }

  if (c.windowDays > 0) parts.push(`over ${c.windowDays} days`);

  if (c.vsLaneMedian != null) {
    if (c.vsLaneMedian < 0) parts.push(`${Math.abs(c.vsLaneMedian)}d faster than lane`);
    else if (c.vsLaneMedian === 0) parts.push("at lane median");
  }

  return parts.join(", ") || "most sailing dates on the lane";
}

/** Why a carrier is worth avoiding — stated as the reason, not as a verdict. */
export function avoidReason(c: CarrierRow, laneCarriers: number): string {
  const parts: string[] = [];

  if (c.sailDates <= 1) parts.push(`only ${c.sailDates} sailing date in the window`);
  else if (c.windowDays > 0 && c.windowDays <= 14)
    parts.push(`${c.sailDates} dates crammed into ${c.windowDays} days`);
  else parts.push(`${c.sailDates} sailing dates`);

  if (c.directDates === 0 && c.ts1Dates === 0 && c.ts2Dates > 0) {
    parts.push("every routing double-transships");
  }
  if (c.vsLaneMedian != null && c.vsLaneMedian > 0) {
    parts.push(`${c.vsLaneMedian}d slower than the lane median`);
  }

  void laneCarriers;
  return parts.join(", ");
}

const list = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
