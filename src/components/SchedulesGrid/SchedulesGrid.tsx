import type { Dispatch, SetStateAction } from "react";
import { ModuleRegistry, AllCommunityModule } from "ag-grid-community";
import type { Schedule } from "../../types/schedule";
import type { ViewMode } from "../../types/view";
import { PlanGrid } from "./PlanGrid";
import { RankGrid } from "./RankGrid";

ModuleRegistry.registerModules([AllCommunityModule]);

interface Props {
  viewMode: ViewMode;
  rows: Schedule[];
  availablePods: string[];
  excludedPods: Set<string>;
  onExcludedPodsChange: Dispatch<SetStateAction<Set<string>>>;
}

export function SchedulesGrid({
  viewMode,
  rows,
  availablePods,
  excludedPods,
  onExcludedPodsChange,
}: Props) {
  return (
    <div className="flex-1 min-h-0 flex flex-col border-t border-rule-strong">
      {viewMode === "carrier" ? (
        <PlanGrid
          rows={rows}
          availablePods={availablePods}
          excludedPods={excludedPods}
          onExcludedPodsChange={onExcludedPodsChange}
        />
      ) : (
        <RankGrid
          rows={rows}
          availablePods={availablePods}
          excludedPods={excludedPods}
          onExcludedPodsChange={onExcludedPodsChange}
        />
      )}
    </div>
  );
}
