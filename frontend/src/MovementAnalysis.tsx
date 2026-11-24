import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, BarChart3, LoaderCircle } from "lucide-react";
import { api } from "./api";
import type { MovementAnalysisRow } from "./types";

type ColumnKey = "symbol" | "movements" | "lastPrice" | "multiplier" | "averageVolume" | "result";
type SortDirection = "asc" | "desc";
type Filters = Record<ColumnKey, string>;

const EMPTY_FILTERS: Filters = {
  symbol: "", movements: "", lastPrice: "", multiplier: "", averageVolume: "", result: ""
};
const formatValue = (value: number | null) => value === null
  ? "—"
  : new Intl.NumberFormat(undefined, { maximumFractionDigits: 12 }).format(value);
const formatCount = (value: number) => new Intl.NumberFormat().format(value);
const columns: { key: ColumnKey; label: string; numeric: boolean; placeholder: string }[] = [
  { key: "symbol", label: "Symbol", numeric: false, placeholder: "Contains…" },
  { key: "movements", label: "Number of movements", numeric: true, placeholder: "e.g. >= 5" },
  { key: "lastPrice", label: "Last price", numeric: true, placeholder: "e.g. > 100" },
  { key: "multiplier", label: "Multiplier", numeric: true, placeholder: "e.g. = 0.001" },
  { key: "averageVolume", label: "Average volume", numeric: true, placeholder: "e.g. >= 1000" },
  { key: "result", label: "Result", numeric: true, placeholder: "e.g. > 10000" }
];

interface Props { hasActiveDataset: boolean; disabled: boolean; }

function matchesNumericFilter(value: number | null, expression: string): boolean {
  if (!expression.trim()) return true;
  if (value === null) return false;
  const match = expression.trim().match(/^(>=|<=|>|<|=)?\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)$/i);
  if (!match) return false;
  const operator = match[1] ?? "=";
  const target = Number(match[2]);
  if (!Number.isFinite(target)) return false;
  switch (operator) {
    case ">": return value > target;
    case ">=": return value >= target;
    case "<": return value < target;
    case "<=": return value <= target;
    default: return value === target;
  }
}

export default function MovementAnalysis({ hasActiveDataset, disabled }: Props) {
  const [threshold, setThreshold] = useState("10");
  const [results, setResults] = useState<MovementAnalysisRow[] | null>(null);
  const [appliedThreshold, setAppliedThreshold] = useState<number | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sortKey, setSortKey] = useState<ColumnKey>("movements");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleResults = useMemo(() => {
    if (!results) return [];
    return results.filter((row) => {
      if (!row.symbol.toLowerCase().includes(filters.symbol.trim().toLowerCase())) return false;
      return columns.filter((column) => column.numeric).every((column) =>
        matchesNumericFilter(row[column.key] as number | null, filters[column.key])
      );
    }).sort((a, b) => {
      const left = a[sortKey];
      const right = b[sortKey];
      let comparison = 0;
      if (left === null) comparison = right === null ? 0 : -1;
      else if (right === null) comparison = 1;
      else if (typeof left === "string" && typeof right === "string") comparison = left.localeCompare(right);
      else comparison = Number(left) - Number(right);
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [filters, results, sortDirection, sortKey]);

  const calculate = async () => {
    const value = Number(threshold);
    if (!threshold.trim() || !Number.isFinite(value) || value <= 0) {
      setError("Enter a threshold greater than 0%.");
      return;
    }
    setCalculating(true);
    setError(null);
    try {
      const response = await api.calculateMovements(value);
      setResults(response.results);
      setAppliedThreshold(response.thresholdPercent);
      setFilters(EMPTY_FILTERS);
      setSortKey("movements");
      setSortDirection("desc");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to calculate movements.");
    } finally {
      setCalculating(false);
    }
  };

  const changeSort = (key: ColumnKey) => {
    if (sortKey === key) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDirection(key === "symbol" ? "asc" : "desc");
    }
  };

  return (
    <section className="panel movement-panel">
      <div className="panel-heading">
        <div className="section-icon purple"><BarChart3 size={18} /></div>
        <div><h2>Price movement analysis</h2><p>Analyze directional movements, average volume, and the calculated contract result.</p></div>
      </div>
      <div className="movement-controls">
        <label className="field movement-threshold">
          <span>Reversal threshold (%)</span>
          <input type="number" min="0.000001" step="any" value={threshold} onChange={(event) => setThreshold(event.target.value)} disabled={calculating || disabled} />
        </label>
        <button className="button button-dark movement-calculate" onClick={() => void calculate()} disabled={!hasActiveDataset || disabled || calculating}>
          {calculating ? <LoaderCircle className="spin" size={16} /> : <BarChart3 size={16} />}
          {calculating ? "Calculating…" : "Calculate movements"}
        </button>
      </div>
      <p className="helper-text movement-explanation">A movement is counted when price advances at least the threshold from a local low or reverses at least the threshold from a local high. Average volume is the arithmetic mean of all candle volume values in the active dataset. Result = last price × multiplier × average volume.</p>
      {!hasActiveDataset && <p className="empty-copy movement-empty">Collect or load a dataset before running analysis.</p>}
      {error && <div className="error-message">{error}</div>}
      {results && <>
        <div className="movement-results-meta">
          <strong>{formatCount(results.length)} symbols analyzed</strong>
          <span>Threshold: {appliedThreshold}%</span>
          <button className="movement-clear-filters" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>
        </div>
        <div className="movement-table-wrap">
          <table className="movement-table">
            <thead>
              <tr>{columns.map((column) => (
                <th key={column.key} className={column.numeric ? "numeric" : undefined}>
                  <button className="movement-sort" onClick={() => changeSort(column.key)}>
                    {column.label}
                    {sortKey === column.key && (sortDirection === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />)}
                  </button>
                  <input
                    className={`movement-column-filter ${column.numeric ? "numeric" : ""}`}
                    aria-label={`Filter ${column.label}`}
                    placeholder={column.placeholder}
                    value={filters[column.key]}
                    onChange={(event) => setFilters((current) => ({ ...current, [column.key]: event.target.value }))}
                  />
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {visibleResults.map((row) => <tr key={row.symbol}>
                <td className="movement-symbol">{row.symbol}</td>
                <td className="numeric">{formatCount(row.movements)}</td>
                <td className="numeric">{formatValue(row.lastPrice)}</td>
                <td className="numeric">{formatValue(row.multiplier)}</td>
                <td className="numeric">{formatValue(row.averageVolume)}</td>
                <td className="numeric">{formatValue(row.result)}</td>
              </tr>)}
              {visibleResults.length === 0 && <tr><td colSpan={6} className="movement-no-results">No rows match the current filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="helper-text">Numeric filters support exact values and comparisons: =, &gt;, &gt;=, &lt;, &lt;= (for example, &gt;= 1000).</p>
      </>}
    </section>
  );
}
