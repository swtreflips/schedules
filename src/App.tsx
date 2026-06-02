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

  const [rows, setRows] = useState<Schedule[]>([]);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSearch = async (params: SearchParams) => {
    setStatus("loading");
    setErrorMessage(null);
    try {
      const fetched = await searchSchedules(params);
      setRows(fetched);
      setStatus("idle");
    } catch (e) {
      setRows([]);
      setErrorMessage((e as Error).message);
      setStatus("error");
    }
  };

  // Client-side filters applied on top of the server-fetched rows.
  // No re-fetch happens when CRD or carriers change — instant.
  const visibleRows = useMemo(() => {
    const crdDate = new Date(crd);
    return rows.filter(
      (s) => enabledCarriers.has(s.carrier_code) && new Date(s.etd) > crdDate
    );
  }, [rows, enabledCarriers, crd]);

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
        enabledCarriers={enabledCarriers}
        onEnabledCarriersChange={setEnabledCarriers}
        onSearch={handleSearch}
        status={status}
        errorMessage={errorMessage}
      />

      <SchedulesGrid viewMode={viewMode} rows={visibleRows} />
    </div>
  );
}
