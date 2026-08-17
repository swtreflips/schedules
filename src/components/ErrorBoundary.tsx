import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Catches render errors so a data surprise degrades instead of erasing the app.
 *
 * There was no boundary here, and the cost showed: one row with a null `eta` threw inside a sort,
 * React unmounted the entire tree, and the screen went white — no message, no header, no way to
 * tell a crash from an empty result. The underlying null is fixed, but the shape of that failure
 * is the real problem. Ingest feeds this app from seven carrier sources and will produce another
 * surprise eventually; when it does, it should cost one screen and a legible message.
 *
 * Deliberately NOT a silent fallback. It says what happened and keeps the error text on screen,
 * because the alternative — a blank panel that looks like "no sailings" — is how the original bug
 * stayed puzzling.
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the component stack in the console — it is what turns "something threw" into a file
    // and a line, and it is lost otherwise.
    console.error("Render error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full flex-col items-start gap-3 px-8 py-10">
        <h1 className="text-[22px] font-medium leading-none tracking-[-0.02em] text-ink">
          Something broke<span className="accent-mark">.</span>
        </h1>
        <p className="max-w-prose text-sm text-secondary">
          This is a bug, not an empty result — the search may well have data behind it. Reloading
          usually clears it; if the same search breaks twice, the details below identify it.
        </p>
        <pre className="max-w-full overflow-x-auto rounded border border-rule bg-panel px-3 py-2 font-mono text-xs text-muted">
          {error.message}
        </pre>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="cursor-pointer rounded border border-rule px-3 py-1.5 text-sm text-ink transition-colors hover:bg-panel"
        >
          Try again
        </button>
      </div>
    );
  }
}
