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

  return (
    <div
      className="flex flex-col gap-2"
      role="group"
      aria-label="Carrier filter"
    >
      <div className="flex items-center justify-between gap-6">
        <span className="eyebrow">
          Carriers · {value.size}/{carriers.length}
        </span>
        <div className="flex items-center">
          <button type="button" className="quick-action" onClick={enableAll}>
            All
          </button>
          <span className="quick-action-sep" aria-hidden>
            ·
          </span>
          <button type="button" className="quick-action" onClick={enableNone}>
            None
          </button>
        </div>
      </div>

      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: "repeat(4, 56px)" }}
      >
        {carriers.map((c) => {
          const active = value.has(c.code);
          return (
            <button
              key={c.code}
              type="button"
              role="switch"
              aria-checked={active}
              aria-label={c.name}
              title={c.name}
              onClick={() => toggle(c.code)}
              className={
                "carrier-chip " +
                (active ? "carrier-chip--active" : "carrier-chip--inactive")
              }
            >
              {c.code}
            </button>
          );
        })}
      </div>
    </div>
  );
}
