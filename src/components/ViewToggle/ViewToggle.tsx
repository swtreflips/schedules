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
  {
    value: "analytics",
    // The tab is MARKET; the value stays "analytics" because it is a route key, not a label — a
    // stored view preference would break on a rename that gains nothing.
    label: "Market",
    // Kept honest: drayage was in the ranking when this hint was written, and is not any more.
    hint:
      "How the market serves your destination — carriers ranked on transit, with the drayage "
      + "left to you shown beside it",
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
