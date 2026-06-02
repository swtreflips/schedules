import { useMemo } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  ModuleRegistry,
  AllCommunityModule,
  themeQuartz,
  type ColDef,
} from "ag-grid-community";
import type { Schedule } from "../../types/schedule";

ModuleRegistry.registerModules([AllCommunityModule]);

const swissTheme = themeQuartz.withParams({
  backgroundColor: "#FFFFFF",
  foregroundColor: "#0A0A0A",
  borderColor: "#E5E5E5",
  chromeBackgroundColor: "#FAFAFA",
  headerBackgroundColor: "#FFFFFF",
  headerTextColor: "#737373",
  headerFontWeight: 500,
  headerFontFamily: "Geist Mono, ui-monospace, monospace",
  cellTextColor: "#0A0A0A",
  oddRowBackgroundColor: "#FFFFFF",
  rowHoverColor: "#FAFAFA",
  selectedRowBackgroundColor: "#FEF2F2",
  accentColor: "#DC2626",
  fontFamily: "Geist, system-ui, sans-serif",
  fontSize: 13,
  rowHeight: 44,
  headerHeight: 40,
  borderRadius: 0,
  wrapperBorderRadius: 0,
  wrapperBorder: false,
});

export function SchedulesGrid() {
  const columnDefs = useMemo<ColDef<Schedule>[]>(
    () => [
      { headerName: "Carrier", field: "carrier_code", width: 120 },
      { headerName: "ETA", field: "eta", width: 130 },
      {
        headerName: "Transit",
        field: "transit_time_days",
        width: 110,
        type: "numericColumn",
      },
      { headerName: "Last CY", field: "last_cy", flex: 1, minWidth: 180 },
      { headerName: "POD", field: "port_of_discharge", flex: 1, minWidth: 180 },
      { headerName: "Type", field: "transport_type", width: 110 },
      { headerName: "Mother Vessel", field: "mother_vessel", flex: 1, minWidth: 200 },
    ],
    []
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable: true,
      resizable: true,
      cellStyle: { fontVariantNumeric: "tabular-nums" },
    }),
    []
  );

  return (
    <div className="flex-1 min-h-0 border-t border-rule-strong">
      <AgGridReact<Schedule>
        theme={swissTheme}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        rowData={[]}
        overlayNoRowsTemplate='<div style="text-align: center;"><div style="font-family: Geist, system-ui, sans-serif; font-size: 15px; font-weight: 500; color: #0A0A0A; margin-bottom: 6px;">No matches yet</div><div style="font-family: Geist Mono, ui-monospace, monospace; font-size: 11px; color: #737373; letter-spacing: 0.02em;">Run a search to qualify schedules geographically.</div></div>'
      />
    </div>
  );
}
