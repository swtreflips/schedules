import type { CarrierRow, Lane } from "./lane";

/**
 * One line describing the market a lane is in.
 *
 * DESCRIPTIVE, NOT PRESCRIPTIVE. An earlier version printed a ready-made "please quote HMM and
 * WHL" sentence. That is gone: naming carriers for the reader turns a table they can interrogate
 * into an instruction they must trust, and the conclusion is one they should reach by looking. The
 * banner says what kind of market this is; the sorted table says who is doing well in it.
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
      // The destination when there is one — the screen is answering for a door, and naming a port
      // the user never typed would read as a different question from the one they asked.
      detail: `Nothing published for ${lane.pol} → ${lane.destination ?? lane.lastCy} in the current window.`,
    };
  }

  // OVER OPTIONS, NOT DATES. "What share of what I could ask for is direct" is the claim worth
  // making; a date carrying a direct and two transships used to count wholly as direct.
  const withDirect = carriers.filter((c) => c.directOptions > 0);
  const directOptions = carriers.reduce((n, c) => n + c.directOptions, 0);
  const allOptions = carriers.reduce((n, c) => n + c.options, 0);
  const pctDirect = allOptions ? Math.round((directOptions / allOptions) * 100) : 0;

  const fastest = [...carriers]
    .filter((c) => c.transit.median != null)
    .sort((a, b) => (a.transit.median ?? 0) - (b.transit.median ?? 0))[0];
  const best = fastest
    ? `Best median ${fastest.transit.median} days (${fastest.carrier}).`
    : "No published transit times.";

  if (!withDirect.length) {
    return {
      tone: "tough",
      headline: "No direct service from any carrier",
      detail: `All ${carriers.length} carriers transship. ${best}`,
    };
  }
  if (pctDirect >= 50) {
    return {
      tone: "healthy",
      headline: `${pctDirect}% of options are direct`,
      detail: `${withDirect.length} of ${carriers.length} carriers run direct. ${best}`,
    };
  }
  return {
    tone: "mixed",
    headline: `Mixed — ${pctDirect}% of options are direct`,
    detail: `Only ${withDirect.length} of ${carriers.length} carriers run direct. ${best}`,
  };
}
