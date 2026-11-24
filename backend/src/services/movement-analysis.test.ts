import assert from "node:assert/strict";
import test from "node:test";
import { analyzeDatasetMovements, calculateSymbolMovements } from "./movement-analysis.js";
import type { KLineDataset } from "../types.js";

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

test("calculates arithmetic mean volume and lastPrice × multiplier × averageVolume", () => {
  const dataset: KLineDataset = {
    schemaVersion: 2,
    jobId: "test-job",
    timeframe: "1hour",
    startTime: "2026-01-01T00:00:00.000Z",
    endTime: "2026-01-01T02:00:00.000Z",
    createdAt: "2026-01-01T02:00:00.000Z",
    symbols: {
      "BTCUSDTM": {
        multiplier: 0.001,
        klines: [
          { timestamp: 2, open: 108, high: 110, low: 107, close: 109, volume: 30, turnover: 0 },
          { timestamp: 1, open: 99, high: 100, low: 98, close: 99, volume: 10, turnover: 0 }
        ]
      }
    }
  };
  const [row] = analyzeDatasetMovements(dataset, 5);
  assert.equal(row.averageVolume, 20);
  assert.equal(row.lastPrice, 110);
  assert.equal(row.result, 110 * 0.001 * 20);
});
