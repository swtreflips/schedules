import type { ViewMode } from "../../types/view";

interface Props {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
}

const OPTIONS: Array<{ value: ViewMode; label: string; hint: string }> = [
  {
    value: "carrier",
    label: "Plan",
    hint: "Best realistic option per carrier — interactive",
  },
  {
    value: "rank",
    label: "Rank",
    hint: "Top schedules globally by earliest ETA",
  },
];

export function ViewToggle({ value, onChange }: Props) {
  return (
    <div role="tablist" aria-label="View mode" className="view-toggle">
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={opt.hint}
            onClick={() => onChange(opt.value)}
            className={
              "view-toggle__tab " +
              (active ? "view-toggle__tab--active" : "")
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
