import type { ReactNode } from "react";

/**
 * The app's identity lockup — icon slot, name, descriptor.
 *
 * ONE STRUCTURE ACROSS THE ESTATE. Freight, Schedules and Planner each carry the same three
 * parts in the same proportions, and differ only in their own colour tokens. A module of the
 * system should be recognisable as one, and adding a fourth app should mean copying this file
 * rather than inventing a header.
 *
 * THE ICON SLOT IS RESERVED, NOT REMOVED. There is no icon yet, so the slot renders empty — but
 * it still occupies its full square, and the tile treatment appears only once something is
 * passed in. An empty coloured tile would read as a broken image; empty space reads as space.
 * When the icon arrives, nothing around it moves.
 *
 * The accent full stop is this app's own device, kept and now shared with the other two.
 */

export const APP_NAME = "Schedules";
export const APP_DESCRIPTOR = "Sailings";

interface Props {
  /** Goes in the reserved slot. Omit until an icon exists. */
  icon?: ReactNode;
  className?: string;
}

export function BrandMark({ icon = null, className = "" }: Props) {
  return (
    <div className={`flex items-center gap-2.5 overflow-hidden ${className}`}>
      <span
        aria-hidden={icon ? undefined : "true"}
        className={
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl " +
          // Tile treatment ONLY when filled — see the note above.
          (icon ? "bg-accent text-white" : "")
        }
      >
        {icon}
      </span>

      <span className="flex flex-col leading-none">
        <span className="text-base font-semibold tracking-[-0.02em] text-ink">
          {APP_NAME}
          <span className="accent-mark">.</span>
        </span>
        <span className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-faint">
          {APP_DESCRIPTOR}
        </span>
      </span>
    </div>
  );
}
