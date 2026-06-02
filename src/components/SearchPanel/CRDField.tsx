import { useId } from "react";

interface Props {
  value: string;
  onChange: (next: string) => void;
}

const today = () => new Date().toISOString().slice(0, 10);

export function CRDField({ value, onChange }: Props) {
  const id = useId();
  const min = today();

  return (
    <div className="flex flex-col" style={{ width: 130 }}>
      <label htmlFor={id} className="field-label">
        Cargo Ready Date
      </label>

      <div className="field-underline">
        <input
          id={id}
          type="date"
          className="field-input date"
          value={value}
          min={min}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}
