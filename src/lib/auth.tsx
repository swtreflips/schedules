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
}

interface AuthState {
  session: Session | null;
  profile: Profile | null | undefined;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);

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
      .select("id, role, full_name")
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
  }, [session?.user?.id]);

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) throw new Error(error.message);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{ session, profile, loading, signInWithGoogle, signOut }}
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
