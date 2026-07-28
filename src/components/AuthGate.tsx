import type { ReactNode } from "react";
import { useAuth } from "../lib/auth";

/**
 * Decides whether anything renders at all.
 *
 * Four states, and the ordering matters — "still loading" must never fall through to
 * "denied", or a slow network reads as a locked account.
 *
 *   loading            → nothing
 *   no session         → sign in
 *   session, no row    → denied. Authenticated is not the same as authorised: anyone with
 *                        a Google account can reach the sign-in, so the profile row is the
 *                        actual gate
 *   session, not internal → denied, with a reason. RLS would already return zero rows, but
 *                        an empty grid looks like a bug; this says what happened
 */

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-bg px-8">
      <h1 className="text-[22px] font-medium leading-none tracking-[-0.02em] text-ink">
        Schedules<span className="accent-mark">.</span>
      </h1>
      {children}
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { session, profile, loading, signInWithGoogle, signOut } = useAuth();

  if (loading || profile === undefined) {
    return <Centered><p className="text-sm text-muted">Loading…</p></Centered>;
  }

  if (!session) {
    return (
      <Centered>
        <button type="button" onClick={signInWithGoogle} className="search-button">
          Sign in with Google
        </button>
        <p className="max-w-xs text-center text-xs text-faint">
          Internal tool. Accounts are created by an administrator — signing in does not
          create one.
        </p>
      </Centered>
    );
  }

  if (!profile || profile.role !== "internal") {
    return (
      <Centered>
        <p className="text-sm text-secondary">
          {session.user.email} has no access to Schedules.
        </p>
        <p className="max-w-sm text-center text-xs text-faint">
          This tool is internal only. If you believe this is wrong, ask an administrator to
          check your profile.
        </p>
        <button type="button" onClick={signOut} className="search-button">
          Sign out
        </button>
      </Centered>
    );
  }

  return <>{children}</>;
}
