import { useEffect, useRef, useState } from "react";

interface Props {
  available: string[];
  excluded: Set<string>;
  onChange: (next: Set<string>) => void;
}

export function PodFilter({ available, excluded, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const totalCount = available.length;
  const enabledCount = totalCount - excluded.size;
  const isFiltered = excluded.size > 0;
  const disabled = totalCount === 0;

  const togglePod = (pod: string) => {
    const next = new Set(excluded);
    if (next.has(pod)) next.delete(pod);
    else next.add(pod);
    onChange(next);
  };

  const selectAll = () => onChange(new Set());
  const selectNone = () => onChange(new Set(available));

  return (
    <div className="pod-filter" ref={wrapperRef}>
      <button
        type="button"
        className={`pod-filter__button${isFiltered ? " pod-filter__button--active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded={open}
        title="Filter by Port of Discharge"
      >
        <span>POD</span>
        {isFiltered && (
          <span className="pod-filter__count">
            {enabledCount}/{totalCount}
          </span>
        )}
        <span className="pod-filter__caret" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="pod-filter__popover" role="dialog" aria-label="Filter PODs">
          <div className="pod-filter__list">
            {available.map((pod) => {
              const checked = !excluded.has(pod);
              return (
                <label key={pod} className="pod-filter__option">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => togglePod(pod)}
                  />
                  <span>{pod}</span>
                </label>
              );
            })}
          </div>
          <div className="pod-filter__footer">
            <button type="button" className="pod-filter__action" onClick={selectAll}>
              all
            </button>
            <span className="pod-filter__sep">·</span>
            <button type="button" className="pod-filter__action" onClick={selectNone}>
              none
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
