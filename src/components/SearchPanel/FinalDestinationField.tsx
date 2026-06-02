import { useId } from "react";

interface Props {
  value: string;
  onChange: (next: string) => void;
}

export function FinalDestinationField({ value, onChange }: Props) {
  const id = useId();

  return (
    <div className="flex flex-col" style={{ width: 200 }}>
      <label htmlFor={id} className="field-label">
        Final Destination
      </label>

      <div className="field-underline">
        <input
          id={id}
          type="text"
          className="field-input"
          placeholder="Hialeah, FL  or  33002"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
        />
      </div>
    </div>
  );
}
