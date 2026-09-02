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
  const stops = [...(s.ts_ports ?? []), s.port_of_discharge].map(canonicalPort);
  return stops.filter((p, i) => p !== stops[i - 1]).join(" > ");
}
