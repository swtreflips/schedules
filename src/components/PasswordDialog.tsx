import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

/**
 * Set your own password.
 *
 * The third copy of this form — RatesApp and the planner have the same one. It is duplicated
 * rather than shared because these are three separately deployed apps with no shared package
 * yet; when `packages/ui-tokens` lands (ROADMAP Tier 3) this is an obvious second tenant.
 *
 * THE CURRENT PASSWORD IS VERIFIED, and Supabase does not require it.
 * `auth.updateUser({ password })` succeeds on any live session, and this project has
 * `security_update_password_require_reauthentication` off — so without this check, reaching an
 * unattended logged-in browser is enough to lock the real user out of their own account with no
 * credential at all.
 *
 * Re-authenticating with `signInWithPassword` as the SAME user swaps one valid session for an
 * equivalent one. A failed attempt leaves the existing session untouched, so a wrong guess costs
 * a message and nothing else.
 */

/** Project setting, `password_min_length`. Stated up front rather than discovered by rejection. */
const MIN_LENGTH = 10;

export function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session, refreshProfile } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (open) return;
    // Never leave a typed password sitting in state behind a closed dialog.
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
    setDone(false);
    setReveal(false);
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && next !== confirm;
  const sameAsOld = next.length > 0 && next === current;
  const canSubmit =
    !busy && current.length > 0 && next.length >= MIN_LENGTH && next === confirm && !sameAsOld;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const email = session?.user?.email;
      if (!email) {
        setError("No signed-in address to check against.");
        return;
      }

      // 1. Prove they know the current one.
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password: current,
      });
      if (authError) {
        setError("That current password is not right.");
        return;
      }

      // 2. Set the new one.
      const { error: updateError } = await supabase.auth.updateUser({ password: next });
      if (updateError) {
        setError(updateError.message);
        return;
      }

      // 3. Clear the onboarding banner. Its failure is swallowed on purpose: the password IS
      //    changed by this point, and reporting an error over a nag flag would tell the user
      //    their password did not change when it did.
      await supabase.rpc("mark_password_changed");
      refreshProfile();

      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="w-full max-w-md overflow-hidden rounded-lg border border-rule bg-bg shadow-xl"
      >
        <div className="flex items-baseline justify-between border-b border-rule px-5 py-3.5">
          <h2 className="text-base font-medium text-ink">Password</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted transition-colors hover:text-ink"
          >
            ✕
          </button>
        </div>

        {done ? (
          <div className="px-5 py-6">
            <p className="text-sm font-medium text-ink">Password updated.</p>
            <p className="mt-1 text-xs text-muted">
              Use it next time you sign in — here and in any other Prime Time tool you have
              access to.
            </p>
            <button type="button" onClick={onClose} className="search-button mt-4">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3 px-5 py-4">
            <p className="text-xs text-muted">
              Signed in as <span className="tabular text-secondary">{session?.user?.email}</span>.
              This is the same login for every Prime Time tool, so changing it here changes it
              everywhere.
            </p>

            <Field label="Current password">
              <div className="field-underline">
                <input
                  type={reveal ? "text" : "password"}
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  autoComplete="current-password"
                  className="field-input w-full"
                />
              </div>
            </Field>

            <Field label={`New password — at least ${MIN_LENGTH} characters`}>
              {/* `.field-input` is styled to sit INSIDE `.field-underline` — the rule that draws
                  the field lives on the wrapper, so bare it is invisible until you type. */}
              <div className="field-underline">
                <input
                  type={reveal ? "text" : "password"}
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  autoComplete="new-password"
                  className="field-input w-full"
                />
              </div>
            </Field>

            <Field label="Confirm new password">
              <div className="field-underline">
                <input
                  type={reveal ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  className="field-input w-full"
                />
              </div>
            </Field>

            {/* A reveal toggle, not a strength meter. Typing a long password blind is the actual
                reason people pick short ones. */}
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={reveal}
                onChange={(e) => setReveal(e.target.checked)}
              />
              Show passwords
            </label>

            {tooShort && <Note>{MIN_LENGTH - next.length} more characters needed.</Note>}
            {mismatch && <Note>The two new passwords do not match.</Note>}
            {sameAsOld && <Note>That is the password you already have.</Note>}
            {error && <Note>{error}</Note>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-sm text-muted transition-colors hover:text-ink"
              >
                Cancel
              </button>
              <button type="submit" disabled={!canSubmit} className="search-button">
                {busy ? "Updating…" : "Update password"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="field-label mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-[#b64a40]">{children}</p>;
}
