import { useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { BrandMark } from "./BrandMark";

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

/**
 * The gate ground.
 *
 * This was a white page with a heading on it. The gate is the first thing anyone sees and the only
 * screen with nothing to do on it, so it is the one place atmosphere costs nothing and buys the
 * most. Four layers, all local: a radial ground, a film grain, a faint graph grid, and — while
 * loading — a sweeping bar.
 */
function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="grain ground ground-grid relative flex h-full flex-col items-center justify-center gap-6 overflow-hidden px-8 text-white">
      {/* above the grain and grid pseudo-elements */}
      <div className="relative flex flex-col items-center gap-6">
        <BrandMark size="lg" tone="dark" />
        {children}
      </div>
    </div>
  );
}

/** The sweeping rail. Its own component so the sign-in and the loading state share one bar. */
function SweepBar() {
  return (
    <div className="relative h-1 w-56 overflow-hidden rounded-full bg-white/10">
      <div className="absolute h-full w-1/4 rounded-full bg-accent-light animate-sweep" />
    </div>
  );
}

function SignInForm({
  onSubmit,
}: {
  onSubmit: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handle = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(email, password);
      // No success branch needed: onAuthStateChange updates the session and this
      // component unmounts.
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handle} className="flex w-full max-w-xs flex-col gap-3">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        autoComplete="username"
        required
        className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none backdrop-blur-sm placeholder:text-white/40 focus:border-accent-light"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        autoComplete="current-password"
        required
        className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none backdrop-blur-sm placeholder:text-white/40 focus:border-accent-light"
      />
      <button type="submit" disabled={submitting} className="cursor-pointer rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-white/15 disabled:opacity-50">
        {submitting ? "Signing in…" : "Sign in"}
      </button>
      {error && <p className="text-xs text-accent-light">{error}</p>}
    </form>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { session, profile, loading, signIn, signOut } = useAuth();

  if (loading || profile === undefined) {
    return (
      <Centered>
        <SweepBar />
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--ground-muted)]">
          Establishing session…
        </p>
      </Centered>
    );
  }

  if (!session) {
    return (
      <Centered>
        <SignInForm onSubmit={signIn} />
        <p className="max-w-xs text-center text-xs text-[var(--ground-muted)]">
          Internal tool. Accounts are created by an administrator — there is no
          self-registration.
        </p>
      </Centered>
    );
  }

  if (!profile || profile.role !== "internal") {
    return (
      <Centered>
        <p className="text-sm text-white/80">
          {session.user.email} has no access to Schedules.
        </p>
        <p className="max-w-sm text-center text-xs text-[var(--ground-muted)]">
          This tool is internal only. If you believe this is wrong, ask an administrator to
          check your profile.
        </p>
        <button type="button" onClick={signOut} className="cursor-pointer rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-white/15">
          Sign out
        </button>
      </Centered>
    );
  }

  return <>{children}</>;
}
