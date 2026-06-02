import { useState } from "react";
import { PortOfLoadingField } from "./PortOfLoadingField";
import { FinalDestinationField } from "./FinalDestinationField";
import { CRDField } from "./CRDField";
import { RadiusField } from "./RadiusField";
import { SearchButton } from "./SearchButton";
import { CarrierFilter } from "../CarrierFilter/CarrierFilter";
import { ViewToggle } from "../ViewToggle/ViewToggle";
import { CARRIERS } from "../../types/carrier";
import type { ViewMode } from "../../types/view";

interface Props {
  viewMode: ViewMode;
  onViewModeChange: (next: ViewMode) => void;
}

const today = () => new Date().toISOString().slice(0, 10);
const DEFAULT_RADIUS_MILES = 187;

export function SearchPanel({ viewMode, onViewModeChange }: Props) {
  const [pol, setPol] = useState("");
  const [destination, setDestination] = useState("");
  const [crd, setCrd] = useState(today);
  const [radius, setRadius] = useState(DEFAULT_RADIUS_MILES);
  const [enabledCarriers, setEnabledCarriers] = useState<Set<string>>(
    () => new Set(CARRIERS.map((c) => c.code))
  );

  const canSubmit =
    pol.trim().length > 0 && destination.trim().length > 0 && radius > 0;

  const handleSubmit = () => {
    // TODO: wire to geocoder + supabase RPC (slice 2 in DEPLOY.md)
    console.log("search submit", {
      pol,
      destination,
      crd,
      radius,
      enabledCarriers: Array.from(enabledCarriers),
      viewMode,
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
            <CRDField value={crd} onChange={setCrd} />
            <RadiusField value={radius} onChange={setRadius} />
            <SearchButton onClick={handleSubmit} disabled={!canSubmit} />
          </div>

          <ViewToggle value={viewMode} onChange={onViewModeChange} />
        </div>

        <CarrierFilter value={enabledCarriers} onChange={setEnabledCarriers} />
      </div>
    </section>
  );
}
