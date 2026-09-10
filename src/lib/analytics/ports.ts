import type { Schedule } from "../../types/schedule";

/**
 * Port complexes: berths that are separate ports on paper and one place in practice.
 *
 * WHY THIS EXISTS. Los Angeles and Long Beach are distinct ports with distinct UN/LOCODEs, and the
 * carriers publish them as such — but they share the San Pedro Bay complex, the same rail ramps and
 * the same drayage market. A box discharged at Long Beach against a Los Angeles Last CY has not
 * taken a different service; it has taken the same service to the other side of the same harbour.
 *
 * Leaving them apart cost real accuracy on the Analytics view. On Ho Chi Minh -> Los Angeles, COSCO's
 * direct sailings were split across `Long Beach, CA` and `Los Angeles, CA`, so its main service read
 * seven dates when it runs more, and each half competed with the other to be named. Worse, a Long
 * Beach discharge against a Los Angeles Last CY was flagged `hasRailLeg` — a rail move that does not
 * happen.
 *
 * SCOPE: THIS AFFECTS ROUTING IDENTITY ONLY. Transshipment counts still come from `ts_ports`, so a
 * genuine hand-off is still a hand-off, and `CarrierRow.pods` still lists the discharge ports as
 * published — a reader who needs to know which berth can still see it. What collapses is only the
 * question "is this the same service".
 *
 * Add complexes here as they come up. Deliberately conservative: two berths belong together only
 * when a box landing at either is the same operational outcome. Oakland and Los Angeles are not a
 * complex; neither are New York and Norfolk. Seattle/Tacoma (The Northwest Seaport Alliance) and
 * New York/Newark are the plausible next entries, but they are not added on a guess.
 */
const COMPLEXES: Array<{ canonical: string; members: string[] }> = [
  {
    canonical: "Los Angeles/Long Beach, CA",
    members: ["los angeles, ca", "long beach, ca"],
  },
];

const CANONICAL = new Map<string, string>(
  COMPLEXES.flatMap((c) => c.members.map((m) => [m, c.canonical] as const)),
);

/** The complex a port belongs to, or the port itself. */
export const canonicalPort = (port: string): string =>
  CANONICAL.get(port.trim().toLowerCase()) ?? port;

/**
 * Just the city — `Ningbo, China` -> `Ningbo`.
 *
 * FOR DISPLAY ONLY, and only where the context already carries the rest. Places are stored as
 * `City, Country` internationally and `City, ST` in the US, and every comparison in this file works
 * on the full string; dropping the tail here would fold `Manzanillo, Panama` into
 * `Manzanillo, Mexico` — 2,900 km apart, and a confusion the MSK scraper had to be fixed for.
 *
 * Used on the transshipment path, where the country adds a line's worth of width per hop and the
 * hubs are recognisable without it. The discharge port and the Last CY keep their full names,
 * because those are the ones a booking is made against.
 */
export const cityOf = (port: string): string => port.split(",")[0].trim();

/**
 * A shortener that keeps the country ONLY where dropping it would be ambiguous.
 *
 * Measured across the 52 transshipment ports in the current market, 51 city names identify their
 * port outright and exactly one does not: `Manzanillo, Panama` and `Manzanillo, Mexico` — a
 * Caribbean hub and a Pacific one, 2,900 km apart, and precisely the confusion the MSK scraper had
 * to be fixed for. Printing a bare "Manzanillo" would put that ambiguity back in the one place it
 * has already caused trouble.
 *
 * DERIVED FROM THE PORTS IN SCOPE, not from a list to maintain. A city that becomes ambiguous when
 * a new hub appears starts showing its country on its own, and one that stops being ambiguous stops.
 */
export function cityLabeller(ports: Iterable<string>): (port: string) => string {
  const byCity = new Map<string, Set<string>>();
  for (const p of ports) {
    const city = cityOf(p);
    const bucket = byCity.get(city);
    if (bucket) bucket.add(p);
    else byCity.set(city, new Set([p]));
  }
  return (port) => ((byCity.get(cityOf(port))?.size ?? 0) > 1 ? port : cityOf(port));
}

/** True when two ports are the same place for operational purposes. */
export const samePlace = (a: string, b: string): boolean =>
  canonicalPort(a) === canonicalPort(b);

/**
 * A connection's routing, as an identity string: transshipment path then discharge, port complexes
 * folded together.
 *
 * Consecutive repeats collapse, so a chain that touches both halves of one complex reads as one
 * stop rather than a hop between them.
 */
export function routeLabel(s: Schedule): string {
  return routeStops(s).join(" > ");
}

/**
 * The same routing as its ordered stops rather than one string — every stop the box touches after
 * loading, ending at the discharge port.
 *
 * SPLIT OUT SO THE TABLE CAN SHOW THE PARTS IN THEIR OWN COLUMNS without parsing the label back
 * apart on " > ". A separator that appears in the data would silently mis-split a routing, and the
 * dedupe below means the parts are not simply `ts_ports` and `port_of_discharge` either — a chain
 * touching both halves of one complex collapses to one stop, so which entry is the discharge port
 * is only knowable after folding.
 *
 * `routeLabel` is this joined, so the string and the parts cannot disagree.
 */
export function routeStops(s: Schedule): string[] {
  const stops = [...(s.ts_ports ?? []), s.port_of_discharge].map(canonicalPort);
  return stops.filter((p, i) => p !== stops[i - 1]);
}
