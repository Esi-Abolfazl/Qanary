import { describe, it, expect } from "vitest";
import { criticalTransitions, blockedTransitions } from "./transitions";
import type { ListStatus, ServiceStatus, EndpointStatus } from "../types";

function mkList(id: string, critical: boolean, all_down: boolean): ListStatus {
  return { id, name: id, icon: "", services: [], all_down, collapsed: false, critical };
}

/** Build a ListStatus where every endpoint has the given state (for blocked tests). */
function mkListWithEndpoints(
  id: string,
  critical: boolean,
  endpointState: EndpointStatus["state"],
  serviceCount = 1,
): ListStatus {
  const ep: EndpointStatus = { id: "e", host: "h", state: endpointState, latency_ms: null };
  const svc: ServiceStatus = { id: "s", label: "s", state: endpointState, endpoints: [ep] };
  const services = Array.from({ length: serviceCount }, (_, i) => ({ ...svc, id: `s${i}` }));
  return {
    id,
    name: id,
    icon: "",
    services,
    all_down: endpointState === "down" || endpointState === "blocked",
    collapsed: false,
    critical,
  };
}

describe("criticalTransitions", () => {
  it("no prev → no transitions (first load)", () => {
    expect(criticalTransitions([], [mkList("a", true, true)])).toEqual([]);
  });

  it("critical list flips to down", () => {
    expect(
      criticalTransitions([mkList("a", true, false)], [mkList("a", true, true)]),
    ).toEqual([{ id: "a", name: "a", dir: "down" }]);
  });

  it("critical list flips to up", () => {
    expect(
      criticalTransitions([mkList("a", true, true)], [mkList("a", true, false)]),
    ).toEqual([{ id: "a", name: "a", dir: "up" }]);
  });

  it("non-critical list ignored even when all_down flips", () => {
    expect(
      criticalTransitions([mkList("b", false, false)], [mkList("b", false, true)]),
    ).toEqual([]);
  });

  it("no change → no transitions", () => {
    expect(
      criticalTransitions([mkList("a", true, true)], [mkList("a", true, true)]),
    ).toEqual([]);
  });

  it("list absent from prev skipped (added mid-session)", () => {
    expect(criticalTransitions([], [mkList("new", true, true)])).toEqual([]);
  });

  it("multiple critical lists — returns one Transition each", () => {
    const result = criticalTransitions(
      [mkList("a", true, false), mkList("b", true, true)],
      [mkList("a", true, true), mkList("b", true, false)],
    );
    expect(result).toContainEqual({ id: "a", name: "a", dir: "down" });
    expect(result).toContainEqual({ id: "b", name: "b", dir: "up" });
    expect(result).toHaveLength(2);
  });
});

describe("blockedTransitions", () => {
  it("no prev → no transitions (first load avoidance)", () => {
    expect(
      blockedTransitions([], [mkListWithEndpoints("a", true, "blocked")]),
    ).toEqual([]);
  });

  it("critical list entering fully-blocked fires", () => {
    expect(
      blockedTransitions(
        [mkListWithEndpoints("a", true, "up")],
        [mkListWithEndpoints("a", true, "blocked")],
      ),
    ).toEqual([{ id: "a", name: "a", dir: "blocked" }]);
  });

  it("non-critical list fully-blocked does NOT fire (non-critical lists never alert)", () => {
    expect(
      blockedTransitions(
        [mkListWithEndpoints("a", false, "up")],
        [mkListWithEndpoints("a", false, "blocked")],
      ),
    ).toEqual([]);
  });

  it("mixed [blocked, down] — not fully-blocked → no fire", () => {
    const ep_blocked: EndpointStatus = { id: "e1", host: "h1", state: "blocked", latency_ms: null };
    const ep_down: EndpointStatus = { id: "e2", host: "h2", state: "down", latency_ms: null };
    const svc: ServiceStatus = { id: "s", label: "s", state: "down", endpoints: [ep_blocked, ep_down] };
    const prev: ListStatus = { id: "x", name: "x", icon: "", services: [svc], all_down: true, collapsed: false, critical: true };
    // Still all failures, but not fully-blocked (one endpoint is "down" not "blocked")
    const next = prev; // unchanged
    expect(blockedTransitions([prev], [next])).toEqual([]);
  });

  it("partial block — a single up endpoint disqualifies", () => {
    const ep_blocked: EndpointStatus = { id: "e1", host: "h1", state: "blocked", latency_ms: null };
    const ep_up: EndpointStatus = { id: "e2", host: "h2", state: "up", latency_ms: null };
    const svc: ServiceStatus = { id: "s", label: "s", state: "blocked", endpoints: [ep_blocked, ep_up] };
    const prev: ListStatus = { id: "y", name: "y", icon: "", services: [svc], all_down: false, collapsed: false, critical: true };
    const next = prev;
    expect(blockedTransitions([prev], [next])).toEqual([]);
  });

  it("recovery (blocked → up) does NOT fire", () => {
    expect(
      blockedTransitions(
        [mkListWithEndpoints("a", true, "blocked")],
        [mkListWithEndpoints("a", true, "up")],
      ),
    ).toEqual([]);
  });

  it("no change (already blocked → still blocked) does NOT fire again", () => {
    const list = mkListWithEndpoints("a", true, "blocked");
    expect(blockedTransitions([list], [list])).toEqual([]);
  });
});
