export interface Carrier {
  code: string;
  name: string;
}

export const CARRIERS: Carrier[] = [
  { code: "HPL", name: "Hapag-Lloyd" },
  { code: "ONE", name: "Ocean Network Express" },
  { code: "WHL", name: "Wan Hai" },
  { code: "HMM", name: "HMM" },
  { code: "MSC", name: "Mediterranean Shipping Company" },
  { code: "MSK", name: "Maersk" },
  { code: "CMA", name: "CMA CGM" },
  { code: "COS", name: "COSCO Shipping Lines" },
  { code: "EMC", name: "Evergreen" },
  { code: "ZIM", name: "ZIM" },
  { code: "YML", name: "Yang Ming" },
  { code: "OOCL", name: "Orient Overseas Container Line" },
];
