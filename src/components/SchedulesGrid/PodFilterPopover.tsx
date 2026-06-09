import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface Props {
  available: string[];
  excluded: Set<string>;
  anchor: DOMRect;
  onTogglePod: (pod: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onClose: () => void;
}

export function PodFilterPopover({
  available,
  excluded,
  anchor,
  onTogglePod,
  onSelectAll,
  onSelectNone,
  onClose,
}: Props) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      // Trigger lives in the AG Grid header and re-opens on click,
      // which would race the outside-click → instant re-open. Skip
      // close when the click landed on (or inside) the trigger.
      if (target.closest?.(".pod-header")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onReflow = () => onClose();
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
  }, [onClose]);

  return createPortal(
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
                onChange={() => onTogglePod(pod)}
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
          onClick={onSelectAll}
        >
          all
        </button>
        <span className="pod-filter__sep">·</span>
        <button
          type="button"
          className="pod-filter__action"
          onClick={onSelectNone}
        >
          none
        </button>
      </div>
    </div>,
    document.body
  );
}
