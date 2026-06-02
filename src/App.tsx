import { SearchPanel } from "./components/SearchPanel/SearchPanel";
import { SchedulesGrid } from "./components/SchedulesGrid/SchedulesGrid";

export function App() {
  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="flex items-baseline justify-between px-10 pt-5 pb-3">
        <div className="flex items-baseline gap-6">
          <h1 className="text-[22px] font-medium leading-none tracking-[-0.02em] text-ink">
            Schedules<span className="accent-mark">.</span>
          </h1>
          <p className="eyebrow">ocean freight, qualified geographically</p>
        </div>
        <div className="section-marker">No. 01 / Search</div>
      </header>

      <SearchPanel />

      <SchedulesGrid />
    </div>
  );
}
