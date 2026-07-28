import { useState, type FormEvent, type ReactNode } from "react";
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
        className="border border-rule bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-rule-strong"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        autoComplete="current-password"
        required
        className="border border-rule bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-rule-strong"
      />
      <button type="submit" disabled={submitting} className="search-button">
        {submitting ? "Signing in…" : "Sign in"}
      </button>
      {error && <p className="text-xs text-accent">{error}</p>}
    </form>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { session, profile, loading, signIn, signOut } = useAuth();

  if (loading || profile === undefined) {
    return <Centered><p className="text-sm text-muted">Loading…</p></Centered>;
  }

  if (!session) {
    return (
      <Centered>
        <SignInForm onSubmit={signIn} />
        <p className="max-w-xs text-center text-xs text-faint">
          Internal tool. Accounts are created by an administrator — there is no
          self-registration.
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
