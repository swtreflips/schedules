import { useMemo, useState } from "react";
import { SearchPanel } from "./components/SearchPanel/SearchPanel";
import { SchedulesGrid } from "./components/SchedulesGrid/SchedulesGrid";
import { searchSchedules, type SearchParams } from "./state/searchSchedules";
import { CARRIERS } from "./types/carrier";
import type { Schedule } from "./types/schedule";
import type { ViewMode } from "./types/view";

const todayString = () => new Date().toISOString().slice(0, 10);

export type SearchStatus = "idle" | "loading" | "error";

export function App() {
  const [viewMode, setViewMode] = useState<ViewMode>("carrier");
  const [crd, setCrd] = useState(todayString);
  const [enabledCarriers, setEnabledCarriers] = useState<Set<string>>(
    () => new Set(CARRIERS.map((c) => c.code))
  );
  const [excludedPods, setExcludedPods] = useState<Set<string>>(() => new Set());

  const [rows, setRows] = useState<Schedule[]>([]);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSearch = async (params: SearchParams) => {
    setStatus("loading");
    setErrorMessage(null);
    try {
      const fetched = await searchSchedules(params);
      setRows(fetched);
      setExcludedPods(new Set());
      setStatus("idle");
    } catch (e) {
      setRows([]);
      setExcludedPods(new Set());
      setErrorMessage((e as Error).message);
      setStatus("error");
    }
  };

  // Client-side filters applied on top of the server-fetched rows.
  // No re-fetch happens when CRD or carriers change — instant.
  // ETD comparison is lexicographic on the YYYY-MM-DD prefix to stay
  // timezone-safe (avoids new Date("2026-06-08") UTC parsing pitfalls).
  const visibleRows = useMemo(() => {
    return rows.filter(
      (s) =>
        enabledCarriers.has(s.carrier_code) &&
        s.etd.slice(0, 10) >= crd &&
        !excludedPods.has(s.port_of_discharge)
    );
  }, [rows, enabledCarriers, crd, excludedPods]);

  // Unique PODs across the full server response — drives the POD filter
  // dropdown. Sourced from `rows` (not `visibleRows`) so a POD never
  // vanishes from the option list once you uncheck it.
  const availablePods = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.port_of_discharge);
    return Array.from(set).sort();
  }, [rows]);

  // Floor for the CRD date picker = earliest ETD in the current dataset.
  // Derived from the full server response (not visibleRows) so the floor
  // doesn't shift as the user changes CRD itself.
  const minCrd = useMemo(() => {
    if (rows.length === 0) return undefined;
    let earliest = rows[0].etd.slice(0, 10);
    for (const r of rows) {
      const d = r.etd.slice(0, 10);
      if (d < earliest) earliest = d;
    }
    return earliest;
  }, [rows]);

  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="px-8 pt-3 pb-2">
        <h1 className="text-[22px] font-medium leading-none tracking-[-0.02em] text-ink">
          Schedules<span className="accent-mark">.</span>
        </h1>
      </header>

      <SearchPanel
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        crd={crd}
        onCrdChange={setCrd}
        minCrd={minCrd}
        enabledCarriers={enabledCarriers}
        onEnabledCarriersChange={setEnabledCarriers}
        onSearch={handleSearch}
        status={status}
        errorMessage={errorMessage}
      />

      <SchedulesGrid
        viewMode={viewMode}
        rows={visibleRows}
        availablePods={availablePods}
        excludedPods={excludedPods}
        onExcludedPodsChange={setExcludedPods}
      />
    </div>
  );
}
