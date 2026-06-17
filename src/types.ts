// Mirror of the Rust types in `src-tauri/src/models.rs`. Keep the two in sync.
// serde serialises the enums in lowercase, so these are lowercase string unions.

export type ServiceState = "up" | "blocked" | "down" | "checking";
export type Severity = "green" | "red";

// ----- Runtime snapshot (read-only, pushed from the backend) -----

export interface ServiceStatus {
  id: string;
  label: string;
  host: string;
  state: ServiceState;
  latency_ms: number | null;
}

export interface ListStatus {
  id: string;
  name: string;
  icon: string;
  services: ServiceStatus[];
  all_down: boolean;
  collapsed: boolean;
}

export interface WanInfo {
  ip: string;
  country_code: string;
  country_name: string;
  flag_emoji: string;
}

export interface Snapshot {
  lists: ListStatus[];
  overall: Severity;
  wan: WanInfo | null;
}

// ----- Persisted config (returned by mutation commands) -----

export interface Service {
  id: string;
  label: string;
  host: string;
  port: number;
  enabled: boolean;
}

export interface ServiceList {
  id: string;
  name: string;
  icon: string;
  services: Service[];
  collapsed: boolean;
}

export interface Config {
  lists: ServiceList[];
  probe_interval_secs: number;
  timeout_ms: number;
  ip_providers: string[];
}
