import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { IHeaderParams } from "ag-grid-community";

export type SortKey = "eta" | "etd" | "transit_time_days";
export type SortDir = "asc" | "desc";

export interface SortCtx {
  key: SortKey;
  dir: SortDir;
  onChange: (key: SortKey, dir: SortDir) => void;
}

interface GridContext {
  sort: SortCtx;
}

interface ExtraParams {
  sortField: SortKey;
}

/**
 * AG Grid header component used for Rank-view's sortable columns
 * (ETA / ETD / Transit Time). Click the header to open a Supabase-
 * style menu with "Sort ascending" / "Sort descending" — picking one
 * drives both the row order and the top-N slice in the parent grid.
 *
 * Reads/writes shared sort state via grid `context.sort`. The column
 * this instance represents is supplied through headerComponentParams
 * as `sortField`.
 */
export function SortHeader(props: IHeaderParams & ExtraParams) {
  const { sort } = props.context as GridContext;
  const field = props.sortField;
  const isActive = sort.key === field;
  const activeDir = isActive ? sort.dir : null;

  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

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

  const toggleOpen = () => {
    if (!open && triggerRef.current) {
      setAnchor(triggerRef.current.getBoundingClientRect());
    }
    setOpen((v) => !v);
  };

  const pick = (dir: SortDir) => {
    sort.onChange(field, dir);
    setOpen(false);
  };

  const indicator = activeDir === "asc" ? "▲" : activeDir === "desc" ? "▼" : "⇅";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`sort-header${isActive ? " sort-header--active" : ""}`}
        onClick={toggleOpen}
        aria-haspopup="true"
        aria-expanded={open}
        title="Sort"
      >
        <span>{props.displayName}</span>
        <span
          className={`sort-header__indicator${
            isActive ? " sort-header__indicator--active" : ""
          }`}
          aria-hidden
        >
          {indicator}
        </span>
      </button>

      {open &&
        anchor &&
        createPortal(
          <div
            ref={popoverRef}
            className="sort-menu"
            style={{
              position: "fixed",
              top: anchor.bottom + 4,
              left: anchor.left,
            }}
            role="menu"
            aria-label="Sort options"
          >
            <button
              type="button"
              role="menuitem"
              className={`sort-menu__item${
                activeDir === "asc" ? " sort-menu__item--active" : ""
              }`}
              onClick={() => pick("asc")}
            >
              <span className="sort-menu__icon" aria-hidden>
                ↑
              </span>
              Sort ascending
            </button>
            <button
              type="button"
              role="menuitem"
              className={`sort-menu__item${
                activeDir === "desc" ? " sort-menu__item--active" : ""
              }`}
              onClick={() => pick("desc")}
            >
              <span className="sort-menu__icon" aria-hidden>
                ↓
              </span>
              Sort descending
            </button>
          </div>,
          document.body
        )}
    </>
  );
}
