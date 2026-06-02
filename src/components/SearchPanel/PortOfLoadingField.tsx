import { useId, useState } from "react";

interface Props {
  value: string;
  onChange: (next: string) => void;
}

export function PortOfLoadingField({ value, onChange }: Props) {
  const id = useId();
  const listboxId = `${id}-listbox`;
  const [open, setOpen] = useState(false);

  // TODO: wire Supabase autocomplete against distinct port_of_loading values.
  const suggestions: string[] = [];

  return (
    <div className="relative flex flex-col" style={{ width: 220 }}>
      <label htmlFor={id} className="field-label">
        Port of Loading
      </label>

      <div
        className="field-underline"
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-haspopup="listbox"
        aria-owns={listboxId}
      >
        <input
          id={id}
          type="text"
          className="field-input"
          placeholder="Laem Chabang, Mundra…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          autoComplete="off"
          aria-autocomplete="list"
          aria-controls={listboxId}
        />
        <span aria-hidden className="ml-2 text-faint text-xs">
          ▾
        </span>
      </div>

      <ul
        id={listboxId}
        role="listbox"
        className="absolute left-0 right-0 top-full z-20 border border-rule bg-bg shadow-sm empty:hidden"
      >
        {/* Intentionally empty for shell — populated by autocomplete in next slice. */}
      </ul>
    </div>
  );
}
