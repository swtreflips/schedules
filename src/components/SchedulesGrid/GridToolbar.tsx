interface Props {
  rowCount: number;
  onDownloadCsv: () => void;
}

export function GridToolbar({ rowCount, onDownloadCsv }: Props) {
  const disabled = rowCount === 0;
  const label =
    rowCount === 0
      ? "no rows"
      : `${rowCount} schedule${rowCount === 1 ? "" : "s"}`;

  return (
    <div className="grid-toolbar">
      <span className="eyebrow">{label}</span>
      <button
        type="button"
        className="icon-button"
        onClick={onDownloadCsv}
        disabled={disabled}
        title="Download visible rows as CSV"
        aria-label="Download CSV"
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="square"
          aria-hidden
        >
          <path d="M8 2 V 10" />
          <path d="M4.5 7 L 8 10.5 L 11.5 7" />
          <path d="M2.5 13.5 H 13.5" />
        </svg>
      </button>
    </div>
  );
}
