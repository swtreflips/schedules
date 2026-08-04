import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { PasswordDialog } from "./PasswordDialog";

/**
 * Account control, top right.
 *
 * This app had no account control at all. Sign-out existed only on the access-DENIED screen, so
 * anyone who got in had no way out and nowhere to manage their login — which mattered little
 * when the app had no login, and matters now that it does.
 *
 * Same shape and order as RatesApp's TopNav and the planner's AccountMenu — identity block,
 * Settings, a rule, then a red sign-out — because one person moves between all three and the
 * account corner should not be a new puzzle in each. Rendered in Schedules' own tokens rather
 * than either app's palette, which is exactly the arrangement OS/DESIGN.md asks for: the
 * invariants carry the family, the accent carries the module.
 *
 * SETTINGS OPENS A DIALOG HERE, not a page. The other two apps route to /settings because they
 * have routers and multiple screens; Schedules is one screen with no navigation, and adding a
 * router for a single destination would be more machinery than the thing it serves. What stays
 * identical is the ENTRY POINT — the account menu, second item, called Settings — which is what
 * someone actually learns.
 */
export function AccountMenu() {
  const { session, profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const email = session?.user?.email ?? "";
  // Name → email → 'Account'. A profile with no full_name is normal for a freshly created
  // login, and an empty avatar reads as a broken app.
  const displayName = profile?.full_name || email || "Account";
  const initials =
    displayName
      .split(/[\s@.]+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?";

  return (
    <>
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex items-center gap-2 rounded px-1.5 py-1 transition-colors hover:bg-panel"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded bg-ink text-[11px] font-bold text-bg">
            {initials}
          </span>
          <span className="hidden text-left leading-tight sm:block">
            <span className="block text-sm font-medium text-ink">{displayName}</span>
            <span className="eyebrow block">Internal</span>
          </span>
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-lg border border-rule bg-bg py-1 shadow-lg"
          >
            <div className="border-b border-rule px-3.5 py-3">
              <p className="eyebrow">Signed in as</p>
              <p className="truncate text-sm font-medium text-ink">{displayName}</p>
              {email && <p className="truncate text-xs text-muted">{email}</p>}
            </div>

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setDialogOpen(true);
              }}
              className="flex w-full items-center px-3.5 py-2 text-left text-sm text-ink transition-colors hover:bg-panel"
            >
              Settings
            </button>

            <div className="my-1 border-t border-rule" />
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex w-full items-center px-3.5 py-2 text-left text-sm text-[#b64a40] transition-colors hover:bg-panel"
            >
              Sign out
            </button>
          </div>
        )}
      </div>

      <PasswordDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}
