export type TransportType = "Direct" | "1 TS" | "2 TS";

export interface Schedule {
  id: string;
  carrier_code: string;
  carrier_name: string;
  port_of_loading: string;
  port_of_discharge: string;
  last_cy: string;
  final_destination: string;
  etd: string;
  eta: string;
  pod_eta: string;
  transit_time_days: number;
  transport_type: TransportType;
  mother_vessel: string;
  ts_ports: string[];
  ts_vessels: string[];
  route_ports: string[];
  vessel_sequence: string[];
}
