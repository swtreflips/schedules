import { useRef } from "react";
import type { IHeaderParams } from "ag-grid-community";

export type SortKey = "eta" | "etd" | "transit_time_days";
export type SortDir = "asc" | "desc";

export interface SortCtx {
  key: SortKey;
  dir: SortDir;
  onOpen: (field: SortKey, anchor: DOMRect) => void;
}

interface GridContext {
  sort: SortCtx;
}

interface ExtraParams {
  sortField: SortKey;
}

/**
 * Minimal AG Grid header trigger for the Rank-view sortable columns
 * (ETA / ETD / Transit Time). Click opens the sort menu, which lives
 * in the parent grid's React tree (see RankGrid).
 *
 * Same architecture as PodFilter — header components don't see grid
 * `context` updates, so the menu is hoisted out and the parent calls
 * `api.refreshHeader()` after sort changes to keep this indicator
 * (▲/▼/⇅) in sync.
 */
export function SortHeader(props: IHeaderParams & ExtraParams) {
  const { sort } = props.context as GridContext;
  const field = props.sortField;
  const triggerRef = useRef<HTMLButtonElement>(null);

  const isActive = sort.key === field;
  const activeDir = isActive ? sort.dir : null;
  const indicator = activeDir === "asc" ? "▲" : activeDir === "desc" ? "▼" : "⇅";

  const handleClick = () => {
    if (!triggerRef.current) return;
    sort.onOpen(field, triggerRef.current.getBoundingClientRect());
  };

  return (
    <button
      ref={triggerRef}
      type="button"
      className={`sort-header${isActive ? " sort-header--active" : ""}`}
      onClick={handleClick}
      aria-haspopup="menu"
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
  );
}
