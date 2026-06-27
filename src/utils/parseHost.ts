/**
 * Normalise any messy host string into a clean `host` or `host/path`.
 *
 * Handles: markdown links, https://, http://, www., /*, trailing slashes.
 * Wildcard host prefixes (`*.`) are preserved — the backend synthesises a concrete
 * subdomain at probe time. Subdomains and paths are also preserved.
 *
 * Examples:
 *   "[https://google.com/](https://goog.com/)" → "goog.com"
 *   "https://www.google.com/"                  → "google.com"
 *   "*.google.com"                             → "*.google.com"  (preserved)
 *   "google.com/*"                             → "google.com"
 *   "docs.google.com"                          → "docs.google.com"
 *   "google.com/inbox"                         → "google.com/inbox"
 */
/** Parse a user-entered host string that may contain an inline port (e.g. `google.com:8080`).
 *  Runs parseHost first to strip scheme/www/path wildcards, then splits on the trailing `:port`.
 *  Port is clamped to 1–65535; out-of-range → undefined (caller defaults to 443). */
export function splitHostPort(raw: string): { host: string; port: number | undefined } {
  const cleaned = parseHost(raw);
  const m = cleaned.match(/^([^:]+):(\d+)$/);
  if (m) {
    const port = Number(m[2]);
    return { host: m[1], port: port >= 1 && port <= 65535 ? port : undefined };
  }
  return { host: cleaned, port: undefined };
}

export function parseHost(raw: string): string {
  let s = raw.trim();
  // [text](url) → extract url from parens
  const md = s.match(/\[.*?\]\(([^)]+)\)/);
  if (md) s = md[1].trim();
  s = s.replace(/^https?:\/\//i, "").replace(/^\/\//, ""); // strip scheme (case-insensitive)
  s = s.replace(/^www\./, "");                             // strip www.
  s = s.replace(/\/\*$/, "");                              // strip wildcard path
  s = s.replace(/\/$/, "");                                // strip trailing slash
  return s;
}
