import { describe, it, expect } from "vitest";
import { parseHost, splitHostPort } from "./parseHost";

describe("parseHost", () => {
  it("strips https scheme", () => {
    expect(parseHost("https://google.com")).toBe("google.com");
  });

  it("strips http scheme (case-insensitive)", () => {
    expect(parseHost("HTTP://Google.com")).toBe("Google.com");
  });

  it("strips www.", () => {
    expect(parseHost("www.google.com")).toBe("google.com");
  });

  it("preserves subdomain other than www", () => {
    expect(parseHost("docs.google.com")).toBe("docs.google.com");
  });

  it("strips wildcard subdomain", () => {
    expect(parseHost("*.google.com")).toBe("google.com");
  });

  it("strips wildcard path", () => {
    expect(parseHost("google.com/*")).toBe("google.com");
  });

  it("strips trailing slash", () => {
    expect(parseHost("google.com/")).toBe("google.com");
  });

  it("preserves non-wildcard path", () => {
    expect(parseHost("google.com/inbox")).toBe("google.com/inbox");
  });

  it("extracts URL from markdown link", () => {
    expect(parseHost("[Google](https://google.com/)")).toBe("google.com");
  });

  it("handles markdown link where URL differs from label", () => {
    expect(parseHost("[text](https://www.example.com/)")).toBe("example.com");
  });

  it("handles plain hostname already clean", () => {
    expect(parseHost("  api.example.com  ")).toBe("api.example.com");
  });
});

describe("splitHostPort", () => {
  it("no port → undefined", () => {
    expect(splitHostPort("google.com")).toEqual({ host: "google.com", port: undefined });
  });

  it("valid port extracted", () => {
    expect(splitHostPort("google.com:8080")).toEqual({ host: "google.com", port: 8080 });
  });

  it("port 0 is out of range → undefined", () => {
    expect(splitHostPort("google.com:0")).toEqual({ host: "google.com", port: undefined });
  });

  it("port 65535 is valid", () => {
    expect(splitHostPort("google.com:65535")).toEqual({ host: "google.com", port: 65535 });
  });

  it("port 65536 out of range → undefined", () => {
    expect(splitHostPort("google.com:65536")).toEqual({ host: "google.com", port: undefined });
  });

  it("strips scheme before port split", () => {
    expect(splitHostPort("https://api.example.com:9000")).toEqual({
      host: "api.example.com",
      port: 9000,
    });
  });
});
