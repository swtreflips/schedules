interface Props {
  onClick: () => void;
  disabled?: boolean;
}

export function SearchButton({ onClick, disabled }: Props) {
  return (
    <div className="flex flex-col">
      <span className="field-label invisible" aria-hidden>
        ·
      </span>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="search-button"
      >
        Search
      </button>
    </div>
  );
}
