// Mirror of the Rust types in `src-tauri/src/models.rs`. Keep the two in sync.
// serde serialises the enums in lowercase, so these are lowercase string unions.

export type ServiceState = "up" | "blocked" | "down" | "checking";
export type Severity = "green" | "yellow" | "red";

// ----- Runtime snapshot (read-only, pushed from the backend) -----

export interface EndpointStatus {
  id: string;
  host: string;
  state: ServiceState;
  latency_ms: number | null;
}

export interface ServiceStatus {
  id: string;
  label: string;
  /** Worst-wins state across all endpoints. Drives the service dot color. */
  state: ServiceState;
  endpoints: EndpointStatus[];
}

export interface ListStatus {
  id: string;
  name: string;
  icon: string;
  services: ServiceStatus[];
  all_down: boolean;
  collapsed: boolean;
  critical: boolean;
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

/**
 * A per-Service Status delta pushed on `service-update`: one Service's new status plus its
 * List's recomputed `all_down` and the new overall Severity. Merged into the local Snapshot.
 * Mirrors `ServiceDelta` in `src-tauri/src/models.rs`.
 */
export interface ServiceDelta {
  list_id: string;
  service: ServiceStatus;
  list_all_down: boolean;
  overall: Severity;
}

// ----- Persisted config (returned by mutation commands) -----

export interface Endpoint {
  id: string;
  host: string;
  port: number;
}

export interface Service {
  id: string;
  label: string;
  enabled: boolean;
  endpoints: Endpoint[];
}

export interface ServiceList {
  id: string;
  name: string;
  icon: string;
  services: Service[];
  collapsed: boolean;
  critical: boolean;
}

export interface Config {
  lists: ServiceList[];
  probe_interval_secs: number;
  timeout_ms: number;
  ip_providers: string[];
  down_notify: boolean;
  down_sound: boolean;
  up_notify: boolean;
  up_sound: boolean;
  hide_dock: boolean;
  last_changelog_version: string | null;
}

// ----- Input types for add/edit commands -----

export interface EndpointDraft {
  host: string;
  port?: number;
}

export interface ServiceDraft {
  label: string;
  endpoints: EndpointDraft[];
}
