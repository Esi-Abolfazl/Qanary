import { describe, it, expect } from "vitest";
import { mergeDelta } from "./mergeDelta";
import type { ServiceDelta, ServiceStatus, Snapshot } from "../types";

function svc(id: string, state: ServiceStatus["state"]): ServiceStatus {
  return { id, label: id, state, endpoints: [{ id: `${id}-e`, host: "h", state, latency_ms: null }] };
}

function snap(): Snapshot {
  return {
    lists: [
      {
        id: "l1",
        name: "L1",
        icon: "",
        services: [svc("a", "up"), svc("b", "down")],
        all_down: false,
        collapsed: false,
        critical: true,
      },
    ],
    overall: "green",
    wan: null,
  };
}

function delta(over: Partial<ServiceDelta> = {}): ServiceDelta {
  return { list_id: "l1", service: svc("b", "up"), list_all_down: false, overall: "green", ...over };
}

describe("mergeDelta", () => {
  it("replaces the right service and sets all_down/overall", () => {
    const out = mergeDelta(snap(), delta({ service: svc("a", "down"), list_all_down: true, overall: "red" }));
    const a = out.lists[0].services.find((s) => s.id === "a")!;
    expect(a.state).toBe("down");
    expect(out.lists[0].all_down).toBe(true);
    expect(out.overall).toBe("red");
  });

  it("leaves sibling services untouched", () => {
    const out = mergeDelta(snap(), delta({ service: svc("a", "blocked") }));
    expect(out.lists[0].services.find((s) => s.id === "b")!.state).toBe("down");
  });

  it("unknown list id → returns input unchanged", () => {
    const s = snap();
    expect(mergeDelta(s, delta({ list_id: "nope" }))).toBe(s);
  });

  it("unknown service id → returns input unchanged", () => {
    const s = snap();
    expect(mergeDelta(s, delta({ service: svc("ghost", "down") }))).toBe(s);
  });

  it("does not mutate the input snapshot", () => {
    const s = snap();
    const frozen = JSON.stringify(s);
    mergeDelta(s, delta({ service: svc("a", "down"), list_all_down: true, overall: "red" }));
    expect(JSON.stringify(s)).toBe(frozen);
  });
});
