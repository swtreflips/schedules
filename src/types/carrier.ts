export interface Carrier {
  code: string;
  name: string;
  hasRates: boolean;
}

export const CARRIERS: Carrier[] = [
  { code: "MSC", name: "Mediterranean Shipping Company", hasRates: true },
  { code: "MAE", name: "Maersk", hasRates: true },
  { code: "CMA", name: "CMA CGM", hasRates: true },
  { code: "COS", name: "COSCO Shipping Lines", hasRates: true },
  { code: "HPL", name: "Hapag-Lloyd", hasRates: true },
  { code: "ONE", name: "Ocean Network Express", hasRates: true },
  { code: "EVG", name: "Evergreen", hasRates: true },
  { code: "ZIM", name: "ZIM", hasRates: true },
  { code: "YML", name: "Yang Ming", hasRates: true },
  { code: "HMM", name: "HMM", hasRates: false },
  { code: "PIL", name: "Pacific International Lines", hasRates: false },
  { code: "WHL", name: "Wan Hai", hasRates: false },
];
