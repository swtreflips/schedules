import { useRef } from "react";
import type { IHeaderParams } from "ag-grid-community";

export interface PodFilterCtx {
  available: string[];
  excluded: Set<string>;
  onOpen: (anchor: DOMRect) => void;
}

interface GridContext {
  podFilter: PodFilterCtx;
}

/**
 * Minimal AG Grid header trigger for the POD column. Renders the
 * "POD" label + count + caret; clicking calls the parent grid's
 * `onOpen(anchor)` so the popover is rendered in the parent React
 * tree (not inside this header component).
 *
 * The popover used to live here, but AG Grid React doesn't propagate
 * grid `context` changes into already-mounted header components.
 * That made every checkbox toggle compute from a stale `excluded`
 * Set, corrupting the filter. Hoisting the popover out — and pairing
 * it with `api.refreshHeader()` on state changes so this trigger
 * label stays in sync — sidesteps the issue entirely.
 */
export function PodFilter(props: IHeaderParams) {
  const { available, excluded, onOpen } = (props.context as GridContext).podFilter;
  const triggerRef = useRef<HTMLButtonElement>(null);

  const totalCount = available.length;
  const enabledCount = totalCount - excluded.size;
  const isFiltered = excluded.size > 0;
  const disabled = totalCount === 0;

  const handleClick = () => {
    if (disabled || !triggerRef.current) return;
    onOpen(triggerRef.current.getBoundingClientRect());
  };

  return (
    <button
      ref={triggerRef}
      type="button"
      className={`pod-header${isFiltered ? " pod-header--active" : ""}`}
      onClick={handleClick}
      disabled={disabled}
      aria-haspopup="dialog"
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
  );
}
