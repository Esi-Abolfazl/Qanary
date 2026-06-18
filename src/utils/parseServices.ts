import { splitHostPort } from "./parseHost";
import type { Service, ServiceDraft } from "../types";

/**
 * Parse a textarea where each non-blank line is one service:
 *   "Label: host1, host2:8080"  → { label: "Label", endpoints: [{host:"host1"}, {host:"host2",port:8080}] }
 *   "host.com"                  → { label: "host.com", endpoints: [{host:"host.com"}] }
 *
 * Lines that produce zero valid endpoints are silently dropped.
 */
export function parseServiceLines(text: string): ServiceDraft[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const colonIdx = line.indexOf(":");
      let rawLabel = "";
      let hostsPart = line;

      // "Label: h1, h2" — but avoid splitting "h.com:8080" (no text before the colon)
      if (colonIdx > 0 && !/^\d+$/.test(line.slice(colonIdx + 1).trim())) {
        const before = line.slice(0, colonIdx).trim();
        // If there's no comma in the before part and it looks like a label (not a host), use it.
        if (!before.includes(",") && !before.includes(".")) {
          rawLabel = before;
          hostsPart = line.slice(colonIdx + 1);
        }
      }

      const endpoints = hostsPart
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean)
        .map(splitHostPort)
        .filter((e) => e.host.length > 0)
        .map((e) => (e.port !== undefined ? { host: e.host, port: e.port } : { host: e.host }));

      if (endpoints.length === 0) return [];

      const label = rawLabel || endpoints[0].host;
      return [{ label, endpoints }];
    });
}

/**
 * Serialise a Service (from Config) to a textarea line for pre-filling the edit modal.
 * "Label: host1, host2:port" — port omitted when 443.
 */
export function serviceToText(svc: Service): string {
  const hosts = svc.endpoints
    .map((e) => e.port === 443 ? e.host : `${e.host}:${e.port}`)
    .join(", ");
  return `${svc.label}: ${hosts}`;
}
