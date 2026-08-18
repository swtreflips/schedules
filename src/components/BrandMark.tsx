import type { ReactNode } from "react";
import vesselIcon from "../assets/vesselIcon.png";

/**
 * The app's identity lockup — icon slot and wordmark.
 *
 * ONE STRUCTURE ACROSS THE ESTATE. Freight, Schedules and Planner carry the same two parts in the
 * same proportions and differ only in their own accent. Adding a fourth app should mean copying
 * this file, not designing a header.
 *
 * ── Why the wordmark is set in Fraunces and the interface is not ──────────────────────────────
 * A logotype wants a face the interface does not use — Adobe Clean, Google Sans and Atlassian's
 * Charlie all exist for this reason. Set in the UI face at UI weight, a name reads as a label; the
 * mark here did, which is why it looked raw. Fraunces is a soft serif with real SOFT and WONK
 * axes, built to feel hand-cut, and it holds that warmth down to 16px.
 *
 * OPTICAL SIZING IS THE BROWSER'S JOB. The font is requested with `opsz` as a range, so it stays
 * variable and `font-optical-sizing: auto` — the default — picks the right optical size on its
 * own. Setting `font-variation-settings` here would silently switch that off.
 *
 * ── Two tones, because the mark lives on two grounds ─────────────────────────────────────────
 * `light` is the app header. `dark` is the sign-in and loading screens, which sit on the night
 * ground. They are not the same colours dimmed: on light the monogram needs `accent-strong` to
 * clear 4.5:1 against its own wash, and on dark it needs `accent-light`, because the mid-tone
 * accent reads muddy against a night-blue ground. Same shape, opposite ends of the ramp.
 *
 * ── The icon ─────────────────────────────────────────────────────────────────────────────────
 * The slot held a monogram until the artwork existed; it now holds the vessel. The reserved space
 * was sized for exactly this, so nothing around it moved when the icon landed.
 *
 * The source was a 1254px, 1.2MB illustration on an OPAQUE white background — it would have
 * covered the accent wash with a white square and glared on the dark gate screen. What ships here
 * is cropped to its content, resized to 192px (4x the largest slot, for retina), and had the
 * background flood-filled to transparent INWARD FROM THE BORDER rather than keyed by colour: the
 * cream deck reads (254,247,229) and the foam is near-white, so a plain white key would have
 * punched holes through the middle of the ship. 42KB, and the wash shows through as intended.
 */

export const APP_NAME = "Schedules";
/** Not rendered in the lockup any more; still the module's description, used for titles. */
export const APP_DESCRIPTOR = "Sailings";

/*
  THE AGREED SLOT SIZE — 51.84px in chrome, 69.12px on the gate screens.

  Settled in Freight by two 20% steps from the original 36 / 48, then copied here and into Planner
  so the mark stays pinned when you switch tabs. The 64px brand bar is the ceiling: 51.84 leaves
  6.1px above and below, and a further step would fill the bar edge to edge.

  The radius scales with the box; a fixed radius on a growing square reads as a shape change
  rather than a size change.
*/
const SIZES = {
  sm: { slot: "h-[3.24rem] w-[3.24rem] rounded-[1.44rem]", gap: "gap-2.5", name: "text-base" },
  lg: { slot: "h-[4.32rem] w-[4.32rem] rounded-[1.66rem]", gap: "gap-3", name: "text-3xl" },
} as const;

/*
  THE DARK SLOT IS A LIGHT PLATE, NOT A DARKER WASH, and the artwork forced it.

  The vessel's hull is rgb(24,44,70). The gate ground is rgb(30,58,79). Those measure 1.19:1
  against each other, so the ship simply vanished and left three coloured containers floating on a
  night sky. No accent wash at any opacity fixes a collision that close.

  On dark the slot therefore becomes its own ground — a paper plate the ship sits on, which reads
  as a sticker and takes the hull to 12.52:1. The wash survives on `light`, where the header is
  white and the hull already clears 14:1.
*/
const TONES = {
  light: { wash: "bg-accent/8", name: "text-ink", dot: "text-accent" },
  dark: { wash: "bg-panel", name: "text-white", dot: "text-accent-light" },
} as const;

interface Props {
  /** Overrides the vessel artwork in the slot. */
  icon?: ReactNode;
  size?: keyof typeof SIZES;
  tone?: keyof typeof TONES;
  className?: string;
}

/*
  THE LOCKUP IS A MARK, NOT A CONTROL.

  Freight and Planner used to wrap theirs in a link home, which left this one — a single screen
  with no router — as plain text. The cursor told three different stories: a hand in two apps and a
  text I-beam here. A logo only earns a link when there is somewhere to go, and faking one here
  would have meant a full reload that discards the loaded search.

  So it is inert in all three now. `select-none` matters as much as the cursor: dragging across a
  wordmark and highlighting it is the tell that something is text rather than a mark.
*/
export function BrandMark({ icon = null, size = "sm", tone = "light", className = "" }: Props) {
  const s = SIZES[size];
  const t = TONES[tone];

  return (
    <div
      className={`flex cursor-default select-none items-center ${s.gap} overflow-hidden ${className}`}
    >
      <span
        className={`flex shrink-0 items-center justify-center overflow-hidden ${s.slot} ${t.wash}`}
      >
        {icon ?? (
          /* alt="" — the name sits right beside it, so announcing the ship twice adds nothing. */
          <img src={vesselIcon} alt="" className="h-full w-full object-contain" />
        )}
      </span>

      <span
        className={`font-logo font-medium leading-none tracking-[-0.005em] ${s.name} ${t.name}`}
      >
        {APP_NAME}
        <span className={t.dot}>.</span>
      </span>
    </div>
  );
}
