import { useState } from "react";
import { PortOfLoadingField } from "./PortOfLoadingField";
import { FinalDestinationField } from "./FinalDestinationField";
import { CRDField } from "./CRDField";
import { RadiusField } from "./RadiusField";
import { SearchButton } from "./SearchButton";
import { CarrierFilter } from "../CarrierFilter/CarrierFilter";
import { ViewToggle } from "../ViewToggle/ViewToggle";
import type { ViewMode } from "../../types/view";
import type { SearchStatus } from "../../App";
import type { SearchParams } from "../../state/searchSchedules";

interface Props {
  viewMode: ViewMode;
  onViewModeChange: (next: ViewMode) => void;
  crd: string;
  onCrdChange: (next: string) => void;
  minCrd?: string;
  enabledCarriers: Set<string>;
  onEnabledCarriersChange: (next: Set<string>) => void;
  onSearch: (params: SearchParams) => void | Promise<void>;
  status: SearchStatus;
  errorMessage: string | null;
}

const DEFAULT_RADIUS_MILES = 187;

export function SearchPanel({
  viewMode,
  onViewModeChange,
  crd,
  onCrdChange,
  minCrd,
  enabledCarriers,
  onEnabledCarriersChange,
  onSearch,
  status,
  errorMessage,
}: Props) {
  const [pol, setPol] = useState("");
  const [destination, setDestination] = useState("");
  const [radius, setRadius] = useState(DEFAULT_RADIUS_MILES);

  const canSubmit =
    pol.trim().length > 0 &&
    destination.trim().length > 0 &&
    radius > 0 &&
    status !== "loading";

  const handleSubmit = () => {
    onSearch({
      pol: pol.trim(),
      destination: destination.trim(),
      radiusMiles: radius,
    });
  };

  return (
    <section
      className="border-b border-rule px-8 pt-2 pb-3"
      aria-label="Search controls"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
            <PortOfLoadingField value={pol} onChange={setPol} />
            <FinalDestinationField
              value={destination}
              onChange={setDestination}
            />
            <CRDField value={crd} onChange={onCrdChange} min={minCrd} />
            <RadiusField value={radius} onChange={setRadius} />
            <SearchButton onClick={handleSubmit} disabled={!canSubmit} />
          </div>

          <div className="flex items-center gap-4">
            <ViewToggle value={viewMode} onChange={onViewModeChange} />

            {status === "loading" && (
              <span className="font-mono text-[11px] tracking-[0.04em] text-muted">
                searching…
              </span>
            )}
            {status === "error" && errorMessage && (
              <span
                className="font-mono text-[11px] tracking-[0.02em] text-accent"
                title={errorMessage}
              >
                error — {errorMessage}
              </span>
            )}
          </div>
        </div>

        <CarrierFilter
          value={enabledCarriers}
          onChange={onEnabledCarriersChange}
        />
      </div>
    </section>
  );
}
