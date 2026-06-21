// Self-check for criticalTransitions — run with: npx tsx src/utils/transitions.test.ts
// ponytail: no framework, plain assert; upgrade to vitest if a test suite is added.

import assert from "node:assert/strict";
import { criticalTransitions } from "./transitions";
import type { ListStatus } from "../types";

function mkList(id: string, critical: boolean, all_down: boolean): ListStatus {
  return { id, name: id, icon: "", services: [], all_down, collapsed: false, critical };
}

// no prev → no transitions (first load, no baseline)
assert.deepEqual(criticalTransitions([], [mkList("a", true, true)]), []);

// critical flip to down
assert.deepEqual(
  criticalTransitions([mkList("a", true, false)], [mkList("a", true, true)]),
  [{ id: "a", name: "a", dir: "down" }],
);

// critical flip to up
assert.deepEqual(
  criticalTransitions([mkList("a", true, true)], [mkList("a", true, false)]),
  [{ id: "a", name: "a", dir: "up" }],
);

// non-critical list ignored even if all_down flips
assert.deepEqual(
  criticalTransitions([mkList("b", false, false)], [mkList("b", false, true)]),
  [],
);

// no change → no transitions
assert.deepEqual(
  criticalTransitions([mkList("a", true, true)], [mkList("a", true, true)]),
  [],
);

console.log("transitions.test.ts: all checks passed ✓");
