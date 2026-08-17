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

const SIZES = {
  sm: { slot: "h-9 w-9 rounded-2xl", gap: "gap-2.5", name: "text-base" },
  lg: { slot: "h-12 w-12 rounded-[1.15rem]", gap: "gap-3", name: "text-3xl" },
} as const;

const TONES = {
  light: { wash: "bg-accent/8", name: "text-ink", dot: "text-accent" },
  dark: { wash: "bg-accent-light/15", name: "text-white", dot: "text-accent-light" },
} as const;

interface Props {
  /** Overrides the vessel artwork in the slot. */
  icon?: ReactNode;
  size?: keyof typeof SIZES;
  tone?: keyof typeof TONES;
  className?: string;
}

export function BrandMark({ icon = null, size = "sm", tone = "light", className = "" }: Props) {
  const s = SIZES[size];
  const t = TONES[tone];

  return (
    <div className={`flex items-center ${s.gap} overflow-hidden ${className}`}>
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
