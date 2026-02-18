import { Component, type ReactNode } from "react";

type Props = {
  onRecover?: () => void;
  fallbackTitle: string;
  fallbackHint: string;
  retryLabel: string;
  children: ReactNode;
};

type State = {
  hasError: boolean;
};

export class AppErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
  };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch() {
    // Error details are captured by the global runtime log listeners.
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
    this.props.onRecover?.();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <div className="m-1 flex h-full items-center justify-center rounded-lg border border-rose-300 bg-rose-50 p-4">
        <div className="max-w-md text-center">
          <h2 className="text-base font-semibold text-rose-700">{this.props.fallbackTitle}</h2>
          <p className="mt-2 text-sm text-rose-600">{this.props.fallbackHint}</p>
          <button
            className="mt-3 rounded border border-rose-400 bg-white px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-100"
            onClick={this.handleRetry}
          >
            {this.props.retryLabel}
          </button>
        </div>
      </div>
    );
  }
}
