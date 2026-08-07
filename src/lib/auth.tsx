import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/**
 * Identity for the Schedules app.
 *
 * This app previously had no login at all — it queried Supabase with the anon key and the
 * project itself was the boundary. Its tables now live in the shared rates project, where
 * `authenticated` includes forwarders and the anon key ships in every RatesApp bundle. So
 * the boundary moved down to the row, and a row-level boundary needs a real identity.
 *
 * Mirrors RatesApp's AuthProvider deliberately: two apps behaving differently at the auth
 * boundary is how one of them ends up wrong.
 *
 *   profile === undefined   still loading — render nothing, decide nothing
 *   profile === null        no row, or the query failed → NO ACCESS
 *   profile.role           'internal' | 'forwarder'
 *
 * `profiles` is the ONLY source of identity. Never user_metadata, which the user can
 * rewrite themselves with supabase.auth.updateUser().
 *
 * A failed query resolves to null rather than retrying or guessing. Denying a real user on
 * a network blip is recoverable; admitting an unknown one is not.
 */

export interface Profile {
  id: string;
  role: string;
  full_name: string | null;
  /** Still on the temporary password issued at onboarding. Drives a banner only. */
  must_change_password: boolean;
}

interface AuthState {
  session: Session | null;
  profile: Profile | null | undefined;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-read the profile — used after a password change clears must_change_password. */
  refreshProfile: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [profileNonce, setProfileNonce] = useState(0);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => setSession(null))
      .finally(() => setLoading(false));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) {
      setProfile(null);
      return;
    }

    let active = true;
    setProfile(undefined); // loading — not "no access"

    supabase
      .from("profiles")
      .select("id, role, full_name, must_change_password")
      .eq("id", uid)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        // No row and a failed query both resolve to null. Fail closed.
        setProfile(error ? null : ((data as Profile) ?? null));
      });

    return () => {
      active = false;
    };
  }, [session?.user?.id, profileNonce]);

  // Email/password, matching RatesApp's signInWithPassword. No OAuth provider is
  // configured on purpose: this organisation runs on Microsoft, not Google, so a Google
  // button would have internal staff signing in with PERSONAL accounts. It would also make
  // the sign-in a public front door, where only the "disable signups" setting stands
  // between a stranger and a role='authenticated' token — which is exactly what the geo
  // brain accepts. With password sign-in and no self-registration there is no public path
  // at all. Entra/Azure OAuth is the upgrade when the hub arrives, since Cloudflare Access
  // can federate the same directory.
  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  };

  /**
   * Sign out of THIS app only.
   *
   * supabase-js defaults to `{ scope: 'global' }`, which revokes every refresh token the user
   * holds. Schedules, RatesApp and the Stuffer Planner all point at the same Supabase project, so
   * the default meant signing out here silently ended the other two — in open tabs and on other
   * devices. The three apps sit on different origins and therefore already keep separate sessions;
   * sign-out should behave the same way.
   *
   * Revisit if these ever move behind one origin (a hub), where one sign-out clearing everything
   * would be what a user expects.
   */
  const signOut = async () => {
    await supabase.auth.signOut({ scope: "local" });
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        signIn,
        signOut,
        refreshProfile: () => setProfileNonce((n) => n + 1),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
