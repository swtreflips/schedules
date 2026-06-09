import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { AgGridReact } from "ag-grid-react";
import {
  type ColDef,
  type RowClickedEvent,
  type ValueGetterParams,
} from "ag-grid-community";
import type { Schedule } from "../../types/schedule";
import {
  buildPlanRows,
  groupByCarrier,
  type PlanRow,
} from "../../state/grouping";
import { GridToolbar } from "./GridToolbar";
import { AlternativesRow } from "./AlternativesRow";
import { PodFilter } from "./PodFilter";
import { PodFilterPopover } from "./PodFilterPopover";
import { swissTheme } from "./theme";

interface Props {
  rows: Schedule[];
  availablePods: string[];
  excludedPods: Set<string>;
  onExcludedPodsChange: Dispatch<SetStateAction<Set<string>>>;
}

const ALT_ITEM_HEIGHT = 32;
const ALT_PADDING = 16;
const ALT_MAX_HEIGHT = 260;

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

export function PlanGrid({
  rows,
  availablePods,
  excludedPods,
  onExcludedPodsChange,
}: Props) {
  const gridRef = useRef<AgGridReact<PlanRow>>(null);
  const [selections, setSelections] = useState<Map<string, string>>(new Map());
  const [expansions, setExpansions] = useState<Set<string>>(new Set());
  const [podPopoverAnchor, setPodPopoverAnchor] = useState<DOMRect | null>(null);

  useEffect(() => {
    setSelections(new Map());
    setExpansions(new Set());
    setPodPopoverAnchor(null);
  }, [rows]);

  // AG Grid React doesn't propagate `context` changes into already-
  // mounted custom header components, so the POD trigger's label
  // (count + accent state) would otherwise read stale data. Force
  // header recreation whenever the excluded set changes.
  useEffect(() => {
    gridRef.current?.api?.refreshHeader();
  }, [excludedPods]);

  const togglePod = useCallback(
    (pod: string) => {
      onExcludedPodsChange((prev) => {
        const next = new Set(prev);
        if (next.has(pod)) next.delete(pod);
        else next.add(pod);
        return next;
      });
    },
    [onExcludedPodsChange]
  );

  const selectAllPods = useCallback(
    () => onExcludedPodsChange(new Set()),
    [onExcludedPodsChange]
  );

  const selectNonePods = useCallback(
    () => onExcludedPodsChange(new Set(availablePods)),
    [onExcludedPodsChange, availablePods]
  );

  const closePodPopover = useCallback(() => setPodPopoverAnchor(null), []);

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
    () => ({
      onSelectAlternative: handleSelectAlternative,
      podFilter: {
        available: availablePods,
        excluded: excludedPods,
        onOpen: setPodPopoverAnchor,
      },
    }),
    [handleSelectAlternative, availablePods, excludedPods]
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
      {
        headerName: "POD",
        valueGetter: scheduleField("port_of_discharge"),
        headerComponent: PodFilter,
        flex: 1,
        minWidth: 150,
      },
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
      fileName: `schedules-plan-${stamp}.csv`,
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

  const label =
    carrierCount === 0
      ? "no carriers"
      : `${carrierCount} carrier${carrierCount === 1 ? "" : "s"} · ${rows.length} schedule${rows.length === 1 ? "" : "s"}`;

  return (
    <>
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
          rowData={planRows}
          context={gridContext}
          getRowId={getRowId}
          getRowHeight={getRowHeight}
          isFullWidthRow={isFullWidthRow}
          fullWidthCellRenderer={AlternativesRow}
          onRowClicked={handleRowClicked}
          overlayNoRowsTemplate='<div style="text-align: center;"><div style="font-family: Geist, system-ui, sans-serif; font-size: 15px; font-weight: 500; color: #0A0A0A; margin-bottom: 6px;">No matches yet</div><div style="font-family: Geist Mono, ui-monospace, monospace; font-size: 11px; color: #737373; letter-spacing: 0.02em;">Run a search to qualify schedules geographically.</div></div>'
          suppressCellFocus
        />
      </div>
      {podPopoverAnchor && (
        <PodFilterPopover
          available={availablePods}
          excluded={excludedPods}
          anchor={podPopoverAnchor}
          onTogglePod={togglePod}
          onSelectAll={selectAllPods}
          onSelectNone={selectNonePods}
          onClose={closePodPopover}
        />
      )}
    </>
  );
}
