import { useState } from "react";
import { PortOfLoadingField } from "./PortOfLoadingField";
import { FinalDestinationField } from "./FinalDestinationField";
import { CRDField } from "./CRDField";
import { CarrierFilter } from "../CarrierFilter/CarrierFilter";
import { CARRIERS } from "../../types/carrier";

const today = () => new Date().toISOString().slice(0, 10);

export function SearchPanel() {
  const [pol, setPol] = useState("");
  const [destination, setDestination] = useState("");
  const [crd, setCrd] = useState(today);
  const [enabledCarriers, setEnabledCarriers] = useState<Set<string>>(
    () => new Set(CARRIERS.map((c) => c.code))
  );

  return (
    <section
      className="border-b border-rule px-10 pt-5 pb-5"
      aria-label="Search controls"
    >
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <PortOfLoadingField value={pol} onChange={setPol} />
        <FinalDestinationField value={destination} onChange={setDestination} />
        <CRDField value={crd} onChange={setCrd} />
      </div>

      <div className="mt-5">
        <CarrierFilter value={enabledCarriers} onChange={setEnabledCarriers} />
      </div>
    </section>
  );
}
