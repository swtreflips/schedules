import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  ModuleRegistry,
  AllCommunityModule,
  themeQuartz,
  type ColDef,
  type RowClickedEvent,
  type ValueGetterParams,
} from "ag-grid-community";
import type { Schedule } from "../../types/schedule";
import type { ViewMode } from "../../types/view";
import {
  buildPlanRows,
  groupByCarrier,
  type PlanRow,
} from "../../state/grouping";
import { GridToolbar } from "./GridToolbar";
import { AlternativesRow } from "./AlternativesRow";

ModuleRegistry.registerModules([AllCommunityModule]);

interface Props {
  viewMode: ViewMode;
  rows: Schedule[];
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

const ALT_ITEM_HEIGHT = 32;
const ALT_PADDING = 16;
const ALT_MAX_HEIGHT = 260;

// Helpers: extract a Schedule field from a PlanRow, returning null for 'alts' rows.
function scheduleField<K extends keyof Schedule>(key: K) {
  return (p: ValueGetterParams<PlanRow>) =>
    p.data?.kind === "main" ? p.data.schedule[key] : null;
}

function scheduleArrayField<K extends keyof Schedule>(key: K) {
  return (p: ValueGetterParams<PlanRow>) => {
    if (p.data?.kind !== "main") return null;
    const v = p.data.schedule[key];
    return Array.isArray(v) ? v.join(" · ") : v;
  };
}

export function SchedulesGrid({ viewMode, rows }: Props) {
  const gridRef = useRef<AgGridReact<PlanRow>>(null);
  const [selections, setSelections] = useState<Map<string, string>>(new Map());
  const [expansions, setExpansions] = useState<Set<string>>(new Set());

  // Reset per-carrier selection + expansion state on a new search.
  useEffect(() => {
    setSelections(new Map());
    setExpansions(new Set());
  }, [rows]);

  const groups = useMemo(() => groupByCarrier(rows), [rows]);

  const planRows = useMemo(
    () => buildPlanRows(groups, selections, expansions),
    [groups, selections, expansions]
  );

  const carrierCount = groups.size;

  const handleSelectAlternative = useCallback(
    (carrier: string, scheduleId: string) => {
      setSelections((prev) => {
        const next = new Map(prev);
        next.set(carrier, scheduleId);
        return next;
      });
      setExpansions((prev) => {
        const next = new Set(prev);
        next.delete(carrier);
        return next;
      });
    },
    []
  );

  const handleRowClicked = useCallback(
    (event: RowClickedEvent<PlanRow>) => {
      const d = event.data;
      if (!d || d.kind !== "main" || d.altCount <= 1) return;
      setExpansions((prev) => {
        const next = new Set(prev);
        if (next.has(d.carrier)) next.delete(d.carrier);
        else next.add(d.carrier);
        return next;
      });
    },
    []
  );

  const gridContext = useMemo(
    () => ({ onSelectAlternative: handleSelectAlternative }),
    [handleSelectAlternative]
  );

  const columnDefs = useMemo<ColDef<PlanRow>[]>(
    () => [
      {
        headerName: "",
        width: 36,
        sortable: false,
        suppressHeaderMenuButton: true,
        cellRenderer: (p: { data?: PlanRow }) => {
          if (p.data?.kind !== "main" || p.data.altCount <= 1) return null;
          return p.data.isExpanded ? "▾" : "▸";
        },
        cellStyle: {
          color: "#737373",
          textAlign: "center",
          cursor: "pointer",
          fontFamily: "Geist Mono, ui-monospace, monospace",
          fontSize: 11,
        },
      },
      { headerName: "Carrier", valueGetter: scheduleField("carrier_code"), width: 100 },
      { headerName: "POL", valueGetter: scheduleField("port_of_loading"), flex: 1, minWidth: 150 },
      { headerName: "POD", valueGetter: scheduleField("port_of_discharge"), flex: 1, minWidth: 150 },
      { headerName: "Last CY", valueGetter: scheduleField("last_cy"), flex: 1, minWidth: 150 },
      { headerName: "ETD", valueGetter: scheduleField("etd"), width: 110 },
      { headerName: "ETA", valueGetter: scheduleField("eta"), width: 110 },
      { headerName: "POD ETA", valueGetter: scheduleField("pod_eta"), width: 110 },
      {
        headerName: "Transit Time",
        valueGetter: scheduleField("transit_time_days"),
        width: 110,
        type: "numericColumn",
      },
      { headerName: "Type", valueGetter: scheduleField("transport_type"), width: 110 },
      { headerName: "Mother Vessel", valueGetter: scheduleField("mother_vessel"), flex: 1.2, minWidth: 170 },
      {
        headerName: "TS Vessel",
        valueGetter: scheduleArrayField("ts_vessels"),
        flex: 1.2,
        minWidth: 150,
      },
      {
        headerName: "TS Port",
        valueGetter: scheduleArrayField("ts_ports"),
        flex: 1,
        minWidth: 130,
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
      shouldRowBeSkipped: (p) => p.node.data?.kind === "alts",
    });
  };

  const getRowId = useCallback(
    (p: { data: PlanRow }) =>
      p.data.kind === "main" ? `m-${p.data.carrier}` : `a-${p.data.carrier}`,
    []
  );

  const getRowHeight = useCallback(
    (p: { data?: PlanRow | null }): number | null | undefined => {
      if (p.data?.kind === "alts") {
        return Math.min(
          p.data.alternatives.length * ALT_ITEM_HEIGHT + ALT_PADDING,
          ALT_MAX_HEIGHT
        );
      }
      return undefined;
    },
    []
  );

  const isFullWidthRow = useCallback(
    (p: { rowNode: { data?: PlanRow | null } }) => p.rowNode.data?.kind === "alts",
    []
  );

  const isPlanMode = viewMode === "carrier";
  const rowData = isPlanMode ? planRows : [];

  const label = !isPlanMode
    ? ""
    : carrierCount === 0
    ? "no carriers"
    : `${carrierCount} carrier${carrierCount === 1 ? "" : "s"} · ${rows.length} schedule${rows.length === 1 ? "" : "s"}`;

  const overlayTemplate = !isPlanMode
    ? '<div style="text-align: center;"><div style="font-family: Geist, system-ui, sans-serif; font-size: 15px; font-weight: 500; color: #0A0A0A; margin-bottom: 6px;">Ranking view</div><div style="font-family: Geist Mono, ui-monospace, monospace; font-size: 11px; color: #737373; letter-spacing: 0.02em;">Coming soon.</div></div>'
    : '<div style="text-align: center;"><div style="font-family: Geist, system-ui, sans-serif; font-size: 15px; font-weight: 500; color: #0A0A0A; margin-bottom: 6px;">No matches yet</div><div style="font-family: Geist Mono, ui-monospace, monospace; font-size: 11px; color: #737373; letter-spacing: 0.02em;">Run a search to qualify schedules geographically.</div></div>';

  return (
    <div className="flex-1 min-h-0 flex flex-col border-t border-rule-strong">
      <GridToolbar
        rowCount={carrierCount}
        label={label}
        onDownloadCsv={handleDownloadCsv}
      />
      <div className="flex-1 min-h-0">
        <AgGridReact<PlanRow>
          ref={gridRef}
          theme={swissTheme}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          rowData={rowData}
          context={gridContext}
          getRowId={getRowId}
          getRowHeight={getRowHeight}
          isFullWidthRow={isFullWidthRow}
          fullWidthCellRenderer={AlternativesRow}
          onRowClicked={handleRowClicked}
          overlayNoRowsTemplate={overlayTemplate}
          suppressCellFocus
        />
      </div>
    </div>
  );
}
