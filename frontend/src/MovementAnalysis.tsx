import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, BarChart3, LoaderCircle, Search } from "lucide-react";
import { api } from "./api";
import type { MovementAnalysisRow } from "./types";

type SortKey = "symbol" | "movements" | "lastPrice" | "multiplier";
type SortDirection = "asc" | "desc";

const formatPrice = (value: number | null) => value === null
  ? "—"
  : new Intl.NumberFormat(undefined, { maximumFractionDigits: 12 }).format(value);
const formatNumber = (value: number) => new Intl.NumberFormat().format(value);

interface Props {
  hasActiveDataset: boolean;
  disabled: boolean;
}

export default function MovementAnalysis({ hasActiveDataset, disabled }: Props) {
  const [threshold, setThreshold] = useState("10");
  const [results, setResults] = useState<MovementAnalysisRow[] | null>(null);
  const [appliedThreshold, setAppliedThreshold] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("movements");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleResults = useMemo(() => {
    if (!results) return [];
    const query = filter.trim().toLowerCase();
    return results.filter((row) => row.symbol.toLowerCase().includes(query)).sort((a, b) => {
      const left = a[sortKey];
      const right = b[sortKey];
      let comparison = 0;
      if (left === null) comparison = right === null ? 0 : -1;
      else if (right === null) comparison = 1;
      else if (typeof left === "string" && typeof right === "string") comparison = left.localeCompare(right);
      else comparison = Number(left) - Number(right);
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [filter, results, sortDirection, sortKey]);

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
      setSortKey("movements");
      setSortDirection("desc");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to calculate movements.");
    } finally {
      setCalculating(false);
    }
  };

  const changeSort = (key: SortKey) => {
    if (sortKey === key) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDirection(key === "symbol" ? "asc" : "desc");
    }
  };

  const heading = (key: SortKey, label: string) => (
    <button className="movement-sort" onClick={() => changeSort(key)} aria-label={`Sort by ${label}`}>
      {label}
      {sortKey === key && (sortDirection === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />)}
    </button>
  );

  return (
    <section className="panel movement-panel">
      <div className="panel-heading">
        <div className="section-icon purple"><BarChart3 size={18} /></div>
        <div><h2>Price movement analysis</h2><p>Count directional movements using KLine high prices only.</p></div>
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
      <p className="helper-text movement-explanation">A movement is counted when price advances at least the threshold from a local low or reverses at least the threshold from a local high. Continued movement in the same direction is counted once.</p>
      {!hasActiveDataset && <p className="empty-copy movement-empty">Collect or load a dataset before running analysis.</p>}
      {error && <div className="error-message">{error}</div>}
      {results && <>
        <div className="movement-results-meta">
          <strong>{formatNumber(results.length)} symbols analyzed</strong>
          <span>Threshold: {appliedThreshold}%</span>
        </div>
        <label className="movement-filter">
          <Search size={16} />
          <input type="search" placeholder="Filter by symbol…" value={filter} onChange={(event) => setFilter(event.target.value)} />
          <span>{formatNumber(visibleResults.length)} shown</span>
        </label>
        <div className="movement-table-wrap">
          <table className="movement-table">
            <thead><tr>
              <th>{heading("symbol", "Symbol")}</th>
              <th className="numeric">{heading("movements", "Number of movements")}</th>
              <th className="numeric">{heading("lastPrice", "Last price")}</th>
              <th className="numeric">{heading("multiplier", "Multiplier")}</th>
            </tr></thead>
            <tbody>
              {visibleResults.map((row) => <tr key={row.symbol}>
                <td className="movement-symbol">{row.symbol}</td>
                <td className="numeric">{formatNumber(row.movements)}</td>
                <td className="numeric">{formatPrice(row.lastPrice)}</td>
                <td className="numeric">{formatPrice(row.multiplier)}</td>
              </tr>)}
              {visibleResults.length === 0 && <tr><td colSpan={4} className="movement-no-results">No matching symbols.</td></tr>}
            </tbody>
          </table>
        </div>
      </>}
    </section>
  );
}
