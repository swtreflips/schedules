import { ModuleRegistry, AllCommunityModule } from "ag-grid-community";
import type { Schedule } from "../../types/schedule";
import type { ViewMode } from "../../types/view";
import { PlanGrid } from "./PlanGrid";
import { RankGrid } from "./RankGrid";

ModuleRegistry.registerModules([AllCommunityModule]);

interface Props {
  viewMode: ViewMode;
  rows: Schedule[];
}

export function SchedulesGrid({ viewMode, rows }: Props) {
  return (
    <div className="flex-1 min-h-0 flex flex-col border-t border-rule-strong">
      {viewMode === "carrier" ? (
        <PlanGrid rows={rows} />
      ) : (
        <RankGrid rows={rows} />
      )}
    </div>
  );
}
