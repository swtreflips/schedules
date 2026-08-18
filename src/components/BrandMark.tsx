import type { ReactNode } from "react";

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
 * ── The monogram ─────────────────────────────────────────────────────────────────────────────
 * The slot holds the app's initial in the logotype face while there is no artwork. It stops the
 * reserved space reading as a gap and lets the three apps look like a family before any icon is
 * drawn. Pass `icon` and it disappears.
 *
 * The vessel lived here and has been withdrawn pending icons generated properly — which is what
 * this placeholder is for, and why removing artwork costs one import and one branch.
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
  sm: { slot: "h-[3.24rem] w-[3.24rem] rounded-[1.44rem]", gap: "gap-2.5", name: "text-base", monogram: "text-[1.35rem]" },
  lg: { slot: "h-[4.32rem] w-[4.32rem] rounded-[1.66rem]", gap: "gap-3", name: "text-3xl", monogram: "text-[1.8rem]" },
} as const;

/*
  Two tones, and they are not the same colours dimmed. On light the monogram needs `accent-strong`
  to clear 4.5:1 against its own wash; on dark it needs `accent-light`, because the mid-tone accent
  reads muddy against a night-blue ground. Opposite ends of the same ramp.

  The dark slot was briefly a light plate — the vessel's navy hull measured 1.19:1 against the gate
  ground and needed paper to sit on. With a monogram that problem does not exist, so the wash comes
  back. Worth remembering when the new artwork lands: dark art on a dark ground will want the plate
  again.
*/
const TONES = {
  light: { wash: "bg-accent/8", monogram: "text-accent-strong", name: "text-ink", dot: "text-accent" },
  dark: { wash: "bg-accent-light/15", monogram: "text-accent-light", name: "text-white", dot: "text-accent-light" },
} as const;

interface Props {
  /** Fills the slot and replaces the monogram. */
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
          <span
            aria-hidden="true"
            className={`font-logo font-medium leading-none ${s.monogram} ${t.monogram}`}
          >
            {APP_NAME.charAt(0)}
          </span>
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
