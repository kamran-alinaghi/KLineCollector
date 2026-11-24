import type { KLineDataset } from "../types.js";

export interface MovementAnalysisRow {
  symbol: string;
  movements: number;
  lastPrice: number | null;
  multiplier: number;
}

/**
 * Counts directional legs once the move from the active local extreme reaches
 * the threshold. A reversal starts the next leg and is counted immediately.
 * Only KLine.high values are used.
 */
export function calculateSymbolMovements(
  highs: number[],
  thresholdPercent: number
): number {
  if (!Number.isFinite(thresholdPercent) || thresholdPercent <= 0) {
    throw new Error("Threshold percentage must be a positive number.");
  }
  const threshold = thresholdPercent / 100;
  const prices = highs.filter((price) => Number.isFinite(price) && price > 0);
  if (prices.length < 2) return 0;

  let direction: "up" | "down" | null = null;
  let initialLow = prices[0];
  let initialHigh = prices[0];
  let extreme = prices[0];
  let movements = 0;

  for (let index = 1; index < prices.length; index += 1) {
    const price = prices[index];

    if (direction === null) {
      initialLow = Math.min(initialLow, price);
      initialHigh = Math.max(initialHigh, price);
      if (price >= initialLow * (1 + threshold)) {
        direction = "up";
        extreme = price;
        movements += 1;
      } else if (price <= initialHigh * (1 - threshold)) {
        direction = "down";
        extreme = price;
        movements += 1;
      }
      continue;
    }

    if (direction === "up") {
      if (price > extreme) {
        extreme = price;
      } else if (price <= extreme * (1 - threshold)) {
        direction = "down";
        extreme = price;
        movements += 1;
      }
    } else if (price < extreme) {
      extreme = price;
    } else if (price >= extreme * (1 + threshold)) {
      direction = "up";
      extreme = price;
      movements += 1;
    }
  }

  return movements;
}

export function analyzeDatasetMovements(
  dataset: KLineDataset,
  thresholdPercent: number
): MovementAnalysisRow[] {
  if (!Number.isFinite(thresholdPercent) || thresholdPercent <= 0) {
    throw new Error("Threshold percentage must be a positive number.");
  }

  return Object.entries(dataset.symbols).map(([symbol, data]) => {
    const sortedKlines = [...data.klines].sort((a, b) => a.timestamp - b.timestamp);
    const highs = sortedKlines.map((kline) => kline.high);
    return {
      symbol,
      movements: calculateSymbolMovements(highs, thresholdPercent),
      lastPrice: highs.length ? highs[highs.length - 1] : null,
      multiplier: data.multiplier
    };
  }).sort((a, b) => b.movements - a.movements || a.symbol.localeCompare(b.symbol));
}
