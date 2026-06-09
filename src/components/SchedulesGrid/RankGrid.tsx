import { useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { type ColDef } from "ag-grid-community";
import type { Schedule } from "../../types/schedule";
import { GridToolbar } from "./GridToolbar";
import { PodFilter } from "./PodFilter";
import { SortHeader, type SortKey, type SortDir } from "./SortHeader";
import { swissTheme } from "./theme";

interface Props {
  rows: Schedule[];
  availablePods: string[];
  excludedPods: Set<string>;
  onExcludedPodsChange: (next: Set<string>) => void;
}

const RANK_TOP_N = 20;

export function RankGrid({
  rows,
  availablePods,
  excludedPods,
  onExcludedPodsChange,
}: Props) {
  const gridRef = useRef<AgGridReact<Schedule>>(null);
  const [sortKey, setSortKey] = useState<SortKey>("eta");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const rankRows = useMemo(() => {
    const sorted = [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "transit_time_days") {
        cmp = a.transit_time_days - b.transit_time_days;
      } else if (sortKey === "etd") {
        cmp = a.etd.localeCompare(b.etd);
      } else {
        cmp = a.eta.localeCompare(b.eta);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted.slice(0, RANK_TOP_N);
  }, [rows, sortKey, sortDir]);

  const handleSortChange = (key: SortKey, dir: SortDir) => {
    setSortKey(key);
    setSortDir(dir);
  };

  const columnDefs = useMemo<ColDef<Schedule>[]>(
    () => [
      {
        headerName: "#",
        width: 50,
        sortable: false,
        suppressHeaderMenuButton: true,
        valueGetter: (p) => (p.node?.rowIndex ?? 0) + 1,
        cellStyle: {
          color: "#737373",
          textAlign: "center",
          fontFamily: "Geist Mono, ui-monospace, monospace",
          fontSize: 11,
          fontVariantNumeric: "tabular-nums",
        },
      },
      { headerName: "Carrier", field: "carrier_code", width: 100 },
      { headerName: "POL", field: "port_of_loading", flex: 1, minWidth: 150 },
      {
        headerName: "POD",
        field: "port_of_discharge",
        headerComponent: PodFilter,
        flex: 1,
        minWidth: 150,
      },
      { headerName: "Last CY", field: "last_cy", flex: 1, minWidth: 150 },
      {
        headerName: "ETD",
        field: "etd",
        width: 110,
        headerComponent: SortHeader,
        headerComponentParams: { sortField: "etd" satisfies SortKey },
      },
      {
        headerName: "ETA",
        field: "eta",
        width: 110,
        headerComponent: SortHeader,
        headerComponentParams: { sortField: "eta" satisfies SortKey },
      },
      { headerName: "POD ETA", field: "pod_eta", width: 110 },
      {
        headerName: "Transit Time",
        field: "transit_time_days",
        width: 110,
        type: "numericColumn",
        headerComponent: SortHeader,
        headerComponentParams: { sortField: "transit_time_days" satisfies SortKey },
      },
      { headerName: "Type", field: "transport_type", width: 110 },
      { headerName: "Mother Vessel", field: "mother_vessel", flex: 1.2, minWidth: 170 },
      {
        headerName: "TS Vessel",
        field: "ts_vessels",
        flex: 1.2,
        minWidth: 150,
        valueFormatter: (p) => (Array.isArray(p.value) ? p.value.join(" · ") : ""),
      },
      {
        headerName: "TS Port",
        field: "ts_ports",
        flex: 1,
        minWidth: 130,
        valueFormatter: (p) => (Array.isArray(p.value) ? p.value.join(" · ") : ""),
      },
    ],
    []
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable: false,
      resizable: true,
      cellStyle: { fontVariantNumeric: "tabular-nums" },
    }),
    []
  );

  const gridContext = useMemo(
    () => ({
      podFilter: {
        available: availablePods,
        excluded: excludedPods,
        onChange: onExcludedPodsChange,
      },
      sort: {
        key: sortKey,
        dir: sortDir,
        onChange: handleSortChange,
      },
    }),
    [availablePods, excludedPods, onExcludedPodsChange, sortKey, sortDir]
  );

  const handleDownloadCsv = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    gridRef.current?.api.exportDataAsCsv({
      fileName: `schedules-ranking-${stamp}.csv`,
    });
  };

  const totalCount = rows.length;
  const shownCount = rankRows.length;
  const label =
    totalCount === 0
      ? "no rows"
      : totalCount <= RANK_TOP_N
      ? `${shownCount} schedule${shownCount === 1 ? "" : "s"}`
      : `top ${shownCount} of ${totalCount} schedules`;

  return (
    <>
      <GridToolbar
        rowCount={shownCount}
        label={label}
        onDownloadCsv={handleDownloadCsv}
      />
      <div className="flex-1 min-h-0">
        <AgGridReact<Schedule>
          ref={gridRef}
          theme={swissTheme}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          rowData={rankRows}
          context={gridContext}
          overlayNoRowsTemplate='<div style="text-align: center;"><div style="font-family: Geist, system-ui, sans-serif; font-size: 15px; font-weight: 500; color: #0A0A0A; margin-bottom: 6px;">No matches yet</div><div style="font-family: Geist Mono, ui-monospace, monospace; font-size: 11px; color: #737373; letter-spacing: 0.02em;">Run a search to see top schedules.</div></div>'
          suppressCellFocus
        />
      </div>
    </>
  );
}
