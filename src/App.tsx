import { useMemo, useState } from "react";
import { AccountMenu } from "./components/AccountMenu";
import { BrandMark } from "./components/BrandMark";
import { useAuth } from "./lib/auth";
import { SearchPanel } from "./components/SearchPanel/SearchPanel";
import { SchedulesGrid } from "./components/SchedulesGrid/SchedulesGrid";
import { searchSchedules, type SearchParams } from "./state/searchSchedules";
import { CARRIERS } from "./types/carrier";
import type { Schedule } from "./types/schedule";
import type { ViewMode } from "./types/view";

const todayString = () => new Date().toISOString().slice(0, 10);

export type SearchStatus = "idle" | "loading" | "error";

/**
 * Still on the password internal read out at onboarding.
 *
 * Left alone, a temporary password becomes a permanent one — nobody remembers months later which
 * accounts were handed over and never changed. Persistent rather than dismissable for that
 * reason, and it never blocks the grid: someone mid-search should not be stopped from working to
 * deal with an account chore. Clearing it lives behind the account menu, one click away.
 */
function TempPasswordBanner() {
  const { profile } = useAuth();
  if (!profile?.must_change_password) return null;

  return (
    <div className="border-y border-rule bg-panel px-8 py-2 text-xs text-secondary">
      You are still using the temporary password you were given — set one only you know under
      Settings, top right.
    </div>
  );
}

export function App() {
  const [viewMode, setViewMode] = useState<ViewMode>("carrier");
  const [crd, setCrd] = useState(todayString);
  const [enabledCarriers, setEnabledCarriers] = useState<Set<string>>(
    () => new Set(CARRIERS.map((c) => c.code))
  );
  const [excludedPods, setExcludedPods] = useState<Set<string>>(() => new Set());

  const [rows, setRows] = useState<Schedule[]>([]);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSearch = async (params: SearchParams) => {
    setStatus("loading");
    setErrorMessage(null);
    try {
      const fetched = await searchSchedules(params);
      setRows(fetched);
      setExcludedPods(new Set());
      setStatus("idle");
    } catch (e) {
      setRows([]);
      setExcludedPods(new Set());
      setErrorMessage((e as Error).message);
      setStatus("error");
    }
  };

  // Client-side filters applied on top of the server-fetched rows.
  // No re-fetch happens when CRD or carriers change — instant.
  // ETD comparison is lexicographic on the YYYY-MM-DD prefix to stay
  // timezone-safe (avoids new Date("2026-06-08") UTC parsing pitfalls).
  const visibleRows = useMemo(() => {
    return rows.filter(
      (s) =>
        enabledCarriers.has(s.carrier_code) &&
        // `etd` is nullable in the schema. A sailing with no departure date cannot be checked
        // against the cargo ready date, and a booking decision needs one, so it is excluded
        // rather than passed through untested.
        s.etd != null &&
        s.etd.slice(0, 10) >= crd &&
        !excludedPods.has(s.port_of_discharge)
    );
  }, [rows, enabledCarriers, crd, excludedPods]);

  // Unique PODs across the full server response — drives the POD filter
  // dropdown. Sourced from `rows` (not `visibleRows`) so a POD never
  // vanishes from the option list once you uncheck it.
  const availablePods = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.port_of_discharge);
    return Array.from(set).sort();
  }, [rows]);

  // Floor for the CRD date picker = earliest ETD in the current dataset.
  // Derived from the full server response (not visibleRows) so the floor
  // doesn't shift as the user changes CRD itself.
  const minCrd = useMemo(() => {
    let earliest: string | undefined;
    for (const r of rows) {
      if (r.etd == null) continue;
      const d = r.etd.slice(0, 10);
      if (earliest === undefined || d < earliest) earliest = d;
    }
    return earliest;
  }, [rows]);

  return (
    <div className="flex h-full flex-col bg-bg">
      {/* Brand bar geometry is shared across Freight, Schedules and Planner: h-16 with px-4 puts
          the icon slot at exactly (16, 14) from the viewport corner in all three, so switching
          browser tabs leaves the mark pinned instead of hopping. */}
      <header className="flex h-16 shrink-0 items-center justify-between px-4">
        {/* Brand lockup — icon slot stays reserved; see BrandMark */}
        <BrandMark />
        <AccountMenu />
      </header>

      <TempPasswordBanner />

      <SearchPanel
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        crd={crd}
        onCrdChange={setCrd}
        minCrd={minCrd}
        enabledCarriers={enabledCarriers}
        onEnabledCarriersChange={setEnabledCarriers}
        onSearch={handleSearch}
        status={status}
        errorMessage={errorMessage}
      />

      <SchedulesGrid
        viewMode={viewMode}
        rows={visibleRows}
        availablePods={availablePods}
        excludedPods={excludedPods}
        onExcludedPodsChange={setExcludedPods}
      />
    </div>
  );
}
