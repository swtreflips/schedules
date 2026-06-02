import { useState } from "react";
import { SearchPanel } from "./components/SearchPanel/SearchPanel";
import { SchedulesGrid } from "./components/SchedulesGrid/SchedulesGrid";
import type { ViewMode } from "./types/view";

export function App() {
  const [viewMode, setViewMode] = useState<ViewMode>("carrier");

  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="px-8 pt-3 pb-2">
        <h1 className="text-[22px] font-medium leading-none tracking-[-0.02em] text-ink">
          Schedules<span className="accent-mark">.</span>
        </h1>
      </header>

      <SearchPanel viewMode={viewMode} onViewModeChange={setViewMode} />

      <SchedulesGrid viewMode={viewMode} />
    </div>
  );
}
