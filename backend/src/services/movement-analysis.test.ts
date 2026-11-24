import assert from "node:assert/strict";
import test from "node:test";
import { calculateSymbolMovements } from "./movement-analysis.js";

test("counts the three directional legs in the example", () => {
  assert.equal(calculateSymbolMovements([100, 103, 120, 112, 108, 106, 119], 10), 3);
});

test("counts a steady rise as one movement", () => {
  assert.equal(calculateSymbolMovements([100, 103, 106, 109], 2), 1);
});

test("counts a downward leg followed by an upward reversal", () => {
  assert.equal(calculateSymbolMovements([100, 90, 80, 90], 10), 2);
});

test("does not count a move that fails to reach the threshold", () => {
  assert.equal(calculateSymbolMovements([100, 103, 108], 10), 0);
});

test("returns zero when fewer than two valid highs are available", () => {
  assert.equal(calculateSymbolMovements([100], 5), 0);
  assert.equal(calculateSymbolMovements([], 5), 0);
});

test("rejects a non-positive threshold", () => {
  assert.throws(() => calculateSymbolMovements([100, 110], 0), /positive number/);
});
