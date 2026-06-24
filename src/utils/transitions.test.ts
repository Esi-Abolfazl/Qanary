import { describe, it, expect } from "vitest";
import { criticalTransitions } from "./transitions";
import type { ListStatus } from "../types";

function mkList(id: string, critical: boolean, all_down: boolean): ListStatus {
  return { id, name: id, icon: "", services: [], all_down, collapsed: false, critical };
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
