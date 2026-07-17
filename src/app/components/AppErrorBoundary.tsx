import { Component, type ReactNode } from "react";
import { runtimeLogWrite } from "../../shared/api/runtime";
import { writeTauriSmokeProgress } from "../smoke/tauriSmokeProgress";

type Props = {
  onRecover?: () => void;
  onCircuitBreak?: () => void;
  fallbackTitle: string;
  fallbackHint: string;
  retryLabel: string;
  circuitBreakerLabel?: string;
  circuitBreakerHint?: string;
  children: ReactNode;
};

type State = {
  hasError: boolean;
  crashCount: number;
};

export class AppErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    crashCount: 0,
  };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    const message = error?.message || String(error || "unknown error");
    const stack = String(info?.componentStack ?? "").replace(/\s+/g, " ").trim().slice(0, 1200);
    void runtimeLogWrite("ERROR", `react.render_error: ${message}; componentStack=${stack}`).catch(() => undefined);
    writeTauriSmokeProgress("frontend.workspace_render_error", "error", { message, stack });
    this.setState((prev) => ({ crashCount: prev.crashCount + 1 }));
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
    this.props.onRecover?.();
  };

  private handleCircuitBreak = () => {
    this.props.onRecover?.();
    this.props.onCircuitBreak?.();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <div className="app-material-shell m-1 flex h-full items-center justify-center rounded-lg border p-4">
        <div className="max-w-md text-center">
          <h2 className="text-base font-semibold text-[color:var(--app-status-danger)]">{this.props.fallbackTitle}</h2>
          <p className="mt-2 text-sm text-[color:var(--app-muted)]">{this.props.fallbackHint}</p>
          <button
            className="control-button control-button--secondary mt-3 px-3 py-1.5 text-sm"
            onClick={this.handleRetry}
          >
            {this.props.retryLabel}
          </button>
          {this.props.onCircuitBreak && this.state.crashCount >= 2 ? (
            <>
              {this.props.circuitBreakerHint ? (
                <p className="mt-3 text-xs text-[color:var(--app-muted)]">{this.props.circuitBreakerHint}</p>
              ) : null}
              <button
                className="control-button control-button--danger mt-2 px-3 py-1.5 text-sm"
                onClick={this.handleCircuitBreak}
              >
                {this.props.circuitBreakerLabel ?? this.props.retryLabel}
              </button>
            </>
          ) : null}
        </div>
      </div>
    );
  }
}
