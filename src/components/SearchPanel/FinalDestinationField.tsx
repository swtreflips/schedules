import { useId, useMemo, useState } from "react";

interface Props {
  value: string;
  onChange: (next: string) => void;
  options: string[];
  loading: boolean;
}

export function FinalDestinationField({ value, onChange, options, loading }: Props) {
  const id = useId();
  const listboxId = `${id}-listbox`;
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!value.trim()) return options;
    const q = value.toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, value]);

  const showList = open && (filtered.length > 0 || loading);

  const handleSelect = (opt: string) => {
    onChange(opt);
    setOpen(false);
  };

  return (
    <div className="relative flex flex-col" style={{ width: 200 }}>
      <label htmlFor={id} className="field-label">
        Final Destination
      </label>

      <div
        className="field-underline"
        role="combobox"
        aria-expanded={showList}
        aria-haspopup="listbox"
        aria-owns={listboxId}
      >
        <input
          id={id}
          type="text"
          className="field-input"
          placeholder={loading ? "loading…" : "Los Angeles, Long Beach…"}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          autoComplete="off"
          aria-autocomplete="list"
          aria-controls={listboxId}
        />
        <span aria-hidden className="ml-2 text-faint text-xs">
          ▾
        </span>
      </div>

      {showList && (
        <ul id={listboxId} role="listbox" className="combobox-listbox">
          {filtered.length === 0 && loading && (
            <li className="combobox-empty">loading…</li>
          )}
          {filtered.length === 0 && !loading && (
            <li className="combobox-empty">no matches</li>
          )}
          {filtered.map((opt) => (
            <li
              key={opt}
              role="option"
              aria-selected={opt === value}
              className={
                "combobox-option " +
                (opt === value ? "combobox-option--selected" : "")
              }
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(opt);
              }}
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
