export type TransportType = "Direct" | "1 TS" | "2 TS";

export interface Schedule {
  id: string;
  carrier_code: string;
  carrier_name: string;
  port_of_loading: string;
  port_of_discharge: string;
  last_cy: string;
  final_destination: string;
  /*
    NULLABLE, because the database says so and the data agrees. Every one of these columns is
    `is_nullable = YES` on `schedules`, and `eta` / `pod_eta` are null on live rows today — a
    carrier will publish a departure before committing to an arrival.

    Declaring them as plain `string` is what allowed `a.eta.localeCompare(b.eta)` to ship: the
    compiler had no reason to object, and the first search whose results included an unpublished
    arrival took the whole app down. Sort and format these through `lib/compare.ts` and explicit
    guards, never directly.
  */
  etd: string | null;
  eta: string | null;
  pod_eta: string | null;
  transit_time_days: number | null;
  transport_type: TransportType;
  mother_vessel: string;
  ts_ports: string[];
  ts_vessels: string[];
  route_ports: string[];
  vessel_sequence: string[];
}
