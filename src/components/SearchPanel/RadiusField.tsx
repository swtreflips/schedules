import { useId } from "react";

interface Props {
  value: number;
  onChange: (next: number) => void;
}

export function RadiusField({ value, onChange }: Props) {
  const id = useId();

  return (
    <div className="flex flex-col" style={{ width: 80 }}>
      <label htmlFor={id} className="field-label">
        Distance
      </label>

      <div className="field-underline">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={1}
          max={1000}
          step={1}
          className="field-input tabular"
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
        />
        <span className="ml-2 font-mono text-[11px] text-muted shrink-0">mi</span>
      </div>
    </div>
  );
}
