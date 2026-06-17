/**
 * Normalise any messy host string into a clean `host` or `host/path`.
 *
 * Handles: markdown links, https://, http://, www., *.  (wildcard), /*, trailing slashes.
 * Subdomains (docs.google.com) and paths (google.com/inbox) are preserved.
 *
 * Examples:
 *   "[https://google.com/](https://goog.com/)" → "goog.com"
 *   "https://www.google.com/"                  → "google.com"
 *   "*.google.com"                             → "google.com"
 *   "google.com/*"                             → "google.com"
 *   "docs.google.com"                          → "docs.google.com"
 *   "google.com/inbox"                         → "google.com/inbox"
 */
export function parseHost(raw: string): string {
  let s = raw.trim();
  // [text](url) → extract url from parens
  const md = s.match(/\[.*?\]\(([^)]+)\)/);
  if (md) s = md[1].trim();
  s = s.replace(/^https?:\/\//i, "").replace(/^\/\//, ""); // strip scheme (case-insensitive)
  s = s.replace(/^www\./, "");                             // strip www.
  s = s.replace(/^\*\./, "");                              // strip wildcard subdomain
  s = s.replace(/\/\*$/, "");                              // strip wildcard path
  s = s.replace(/\/$/, "");                                // strip trailing slash
  return s;
}
