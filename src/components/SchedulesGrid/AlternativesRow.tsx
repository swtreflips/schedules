import type { ICellRendererParams } from "ag-grid-community";
import type { PlanRow } from "../../state/grouping";

interface GridContext {
  onSelectAlternative: (carrier: string, scheduleId: string) => void;
}

export function AlternativesRow(
  params: ICellRendererParams<PlanRow> & { context: GridContext }
) {
  const data = params.data;
  if (!data || data.kind !== "alts") return null;

  const { carrier, alternatives, selectedId } = data;
  const onSelect = params.context.onSelectAlternative;

  return (
    <div className="alts-container">
      {alternatives.map((s) => {
        const isSelected = s.id === selectedId;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(carrier, s.id)}
            className={"alt-item " + (isSelected ? "alt-item--selected" : "")}
            title={`Select this schedule for ${carrier}`}
          >
            <span>
              <span className="alt-label">ETD</span>
              {s.etd}
            </span>
            <span>
              <span className="alt-label">ETA</span>
              {s.eta}
            </span>
            <span>
              <span className="alt-label">TT</span>
              {s.transit_time_days}d
            </span>
            <span>
              <span className="alt-label">TYPE</span>
              {s.transport_type}
            </span>
            <span className="alt-vessel">{s.mother_vessel}</span>
          </button>
        );
      })}
    </div>
  );
}
