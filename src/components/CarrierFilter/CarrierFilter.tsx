import { CARRIERS, type Carrier } from "../../types/carrier";

interface Props {
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  carriers?: Carrier[];
}

export function CarrierFilter({ value, onChange, carriers = CARRIERS }: Props) {
  const toggle = (code: string) => {
    const next = new Set(value);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange(next);
  };

  const enableAll = () => onChange(new Set(carriers.map((c) => c.code)));
  const enableNone = () => onChange(new Set());
  const enableRatedOnly = () =>
    onChange(new Set(carriers.filter((c) => c.hasRates).map((c) => c.code)));

  return (
    <div
      className="flex flex-wrap items-center gap-x-5 gap-y-2"
      role="group"
      aria-label="Carrier filter"
    >
      <span className="eyebrow shrink-0">
        Carriers · {value.size}/{carriers.length}
      </span>

      <div className="flex flex-wrap gap-1.5">
        {carriers.map((c) => {
          const active = value.has(c.code);
          return (
            <button
              key={c.code}
              type="button"
              role="switch"
              aria-checked={active}
              aria-label={c.name}
              title={c.name + (c.hasRates ? "" : " — no rates loaded")}
              onClick={() => toggle(c.code)}
              className={
                "carrier-chip " +
                (active ? "carrier-chip--active" : "carrier-chip--inactive")
              }
            >
              {c.code}
              {!c.hasRates && <sup aria-hidden>·</sup>}
            </button>
          );
        })}
      </div>

      <div className="flex items-center ml-auto">
        <button type="button" className="quick-action" onClick={enableAll}>
          All
        </button>
        <span className="quick-action-sep" aria-hidden>
          ·
        </span>
        <button type="button" className="quick-action" onClick={enableNone}>
          None
        </button>
        <span className="quick-action-sep" aria-hidden>
          ·
        </span>
        <button type="button" className="quick-action" onClick={enableRatedOnly}>
          Rated only
        </button>
      </div>
    </div>
  );
}
