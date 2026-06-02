import { useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  ModuleRegistry,
  AllCommunityModule,
  themeQuartz,
  type ColDef,
} from "ag-grid-community";
import type { Schedule } from "../../types/schedule";
import type { ViewMode } from "../../types/view";
import { GridToolbar } from "./GridToolbar";

ModuleRegistry.registerModules([AllCommunityModule]);

interface Props {
  viewMode: ViewMode;
}

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

export function SchedulesGrid(_props: Props) {
  // viewMode prop will drive grouping (per-carrier vs flat ranking) once data wires.
  // Currently unused since rowData is empty.
  const gridRef = useRef<AgGridReact<Schedule>>(null);
  const [rowCount, setRowCount] = useState(0);

  const columnDefs = useMemo<ColDef<Schedule>[]>(
    () => [
      { headerName: "Carrier", field: "carrier_code", width: 100 },
      { headerName: "POL", field: "port_of_loading", flex: 1, minWidth: 150 },
      { headerName: "POD", field: "port_of_discharge", flex: 1, minWidth: 150 },
      { headerName: "Last CY", field: "last_cy", flex: 1, minWidth: 150 },
      { headerName: "ETD", field: "etd", width: 110 },
      { headerName: "ETA", field: "eta", width: 110 },
      { headerName: "POD ETA", field: "pod_eta", width: 110 },
      {
        headerName: "Transit Time",
        field: "transit_time_days",
        width: 110,
        type: "numericColumn",
      },
      { headerName: "Type", field: "transport_type", width: 110 },
      { headerName: "Mother Vessel", field: "mother_vessel", flex: 1.2, minWidth: 170 },
      {
        headerName: "TS Vessel",
        field: "ts_vessels",
        flex: 1.2,
        minWidth: 150,
        valueFormatter: (p) =>
          Array.isArray(p.value) ? p.value.join(" · ") : "",
      },
      {
        headerName: "TS Port",
        field: "ts_ports",
        flex: 1,
        minWidth: 130,
        valueFormatter: (p) =>
          Array.isArray(p.value) ? p.value.join(" · ") : "",
      },
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

  const handleDownloadCsv = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    gridRef.current?.api.exportDataAsCsv({
      fileName: `schedules-${stamp}.csv`,
    });
  };

  const handleModelUpdated = () => {
    const n = gridRef.current?.api.getDisplayedRowCount() ?? 0;
    setRowCount(n);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col border-t border-rule-strong">
      <GridToolbar rowCount={rowCount} onDownloadCsv={handleDownloadCsv} />
      <div className="flex-1 min-h-0">
        <AgGridReact<Schedule>
          ref={gridRef}
          theme={swissTheme}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          rowData={[]}
          onModelUpdated={handleModelUpdated}
          overlayNoRowsTemplate='<div style="text-align: center;"><div style="font-family: Geist, system-ui, sans-serif; font-size: 15px; font-weight: 500; color: #0A0A0A; margin-bottom: 6px;">No matches yet</div><div style="font-family: Geist Mono, ui-monospace, monospace; font-size: 11px; color: #737373; letter-spacing: 0.02em;">Run a search to qualify schedules geographically.</div></div>'
        />
      </div>
    </div>
  );
}
