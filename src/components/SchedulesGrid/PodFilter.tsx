import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { IHeaderParams } from "ag-grid-community";

export interface PodFilterCtx {
  available: string[];
  excluded: Set<string>;
  onChange: (next: Set<string>) => void;
}

interface GridContext {
  podFilter: PodFilterCtx;
}

/**
 * AG Grid header component for the POD column. Renders the "POD" label
 * as a clickable trigger; opens a portaled popover with one checkbox per
 * unique POD in the current dataset. Active state (some PODs excluded)
 * brings up contrast + shows a count.
 *
 * Reads its data from grid `context.podFilter`, set by the parent grid
 * component. Using context (instead of headerComponentParams) avoids
 * stale closures when the underlying state changes — context updates
 * are picked up live by AG Grid.
 */
export function PodFilter(props: IHeaderParams) {
  const { available, excluded, onChange } = (props.context as GridContext).podFilter;

  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click + Escape + scroll/resize (avoids the
  // popover drifting away from the trigger).
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReflow = () => setOpen(false);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open]);

  const totalCount = available.length;
  const enabledCount = totalCount - excluded.size;
  const isFiltered = excluded.size > 0;
  const disabled = totalCount === 0;

  const toggleOpen = () => {
    if (disabled) return;
    if (!open && triggerRef.current) {
      setAnchor(triggerRef.current.getBoundingClientRect());
    }
    setOpen((v) => !v);
  };

  const togglePod = (pod: string) => {
    const next = new Set(excluded);
    if (next.has(pod)) next.delete(pod);
    else next.add(pod);
    onChange(next);
  };

  const selectAll = () => onChange(new Set());
  const selectNone = () => onChange(new Set(available));

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`pod-header${isFiltered ? " pod-header--active" : ""}`}
        onClick={toggleOpen}
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded={open}
        title="Filter by Port of Discharge"
      >
        <span>{props.displayName}</span>
        {isFiltered && (
          <span className="pod-header__count">
            {enabledCount}/{totalCount}
          </span>
        )}
        {!disabled && (
          <span className="pod-header__caret" aria-hidden>
            ▾
          </span>
        )}
      </button>

      {open &&
        anchor &&
        createPortal(
          <div
            ref={popoverRef}
            className="pod-filter__popover"
            style={{
              position: "fixed",
              top: anchor.bottom + 4,
              left: anchor.left,
            }}
            role="dialog"
            aria-label="Filter PODs"
          >
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
              <button
                type="button"
                className="pod-filter__action"
                onClick={selectAll}
              >
                all
              </button>
              <span className="pod-filter__sep">·</span>
              <button
                type="button"
                className="pod-filter__action"
                onClick={selectNone}
              >
                none
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
