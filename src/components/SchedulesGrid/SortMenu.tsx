import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { SortDir } from "./SortHeader";

interface Props {
  anchor: DOMRect;
  activeDir: SortDir | null;
  onPick: (dir: SortDir) => void;
  onClose: () => void;
}

export function SortMenu({ anchor, activeDir, onPick, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (target.closest?.(".sort-header")) return;
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
      ref={menuRef}
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
        onClick={() => onPick("asc")}
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
        onClick={() => onPick("desc")}
      >
        <span className="sort-menu__icon" aria-hidden>
          ↓
        </span>
        Sort descending
      </button>
    </div>,
    document.body
  );
}
