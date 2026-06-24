import { describe, it, expect } from "vitest";
import { parseServiceLines, serviceToText } from "./parseServices";
import type { Service } from "../types";

describe("parseServiceLines", () => {
  it("bare hostname → label = host, one endpoint", () => {
    expect(parseServiceLines("google.com")).toEqual([
      { label: "google.com", endpoints: [{ host: "google.com" }] },
    ]);
  });

  it("label: host syntax", () => {
    expect(parseServiceLines("Google: google.com")).toEqual([
      { label: "Google", endpoints: [{ host: "google.com" }] },
    ]);
  });

  it("multiple hosts, comma-separated", () => {
    expect(parseServiceLines("CDN: a.com, b.com")).toEqual([
      { label: "CDN", endpoints: [{ host: "a.com" }, { host: "b.com" }] },
    ]);
  });

  it("host with port parsed", () => {
    expect(parseServiceLines("api.com:8080")).toEqual([
      { label: "api.com", endpoints: [{ host: "api.com", port: 8080 }] },
    ]);
  });

  it("label with port in host", () => {
    expect(parseServiceLines("API: api.com:9000")).toEqual([
      { label: "API", endpoints: [{ host: "api.com", port: 9000 }] },
    ]);
  });

  it("blank lines ignored", () => {
    expect(parseServiceLines("\ngoogle.com\n\nexample.com\n")).toEqual([
      { label: "google.com", endpoints: [{ host: "google.com" }] },
      { label: "example.com", endpoints: [{ host: "example.com" }] },
    ]);
  });

  it("empty string → empty array", () => {
    expect(parseServiceLines("")).toEqual([]);
  });

  it("scheme in bare line: colon triggers label split (https → label, //host → endpoint)", () => {
    // parseServiceLines splits on first colon; "https" becomes the label, "//google.com"
    // is the host part (parseHost strips the leading //). Expected actual behaviour.
    expect(parseServiceLines("https://google.com")).toEqual([
      { label: "https", endpoints: [{ host: "google.com" }] },
    ]);
  });

  it("label with dot not mistaken for label separator", () => {
    // "docs.google.com" has a dot in the "before-colon" part — should be treated as host
    expect(parseServiceLines("docs.google.com")).toEqual([
      { label: "docs.google.com", endpoints: [{ host: "docs.google.com" }] },
    ]);
  });
});

describe("serviceToText", () => {
  const svc = (label: string, endpoints: { host: string; port: number }[]): Service => ({
    id: "x",
    label,
    enabled: true,
    endpoints: endpoints.map((e, i) => ({ id: String(i), ...e })),
  });

  it("single host at 443 → no port shown", () => {
    expect(serviceToText(svc("Google", [{ host: "google.com", port: 443 }]))).toBe(
      "Google: google.com",
    );
  });

  it("non-443 port shown", () => {
    expect(serviceToText(svc("API", [{ host: "api.com", port: 8080 }]))).toBe(
      "API: api.com:8080",
    );
  });

  it("multiple endpoints joined", () => {
    expect(
      serviceToText(
        svc("CDN", [
          { host: "cdn1.com", port: 443 },
          { host: "cdn2.com", port: 8080 },
        ]),
      ),
    ).toBe("CDN: cdn1.com, cdn2.com:8080");
  });
});
