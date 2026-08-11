import { Component, type ReactNode } from "react";
import { enUS, type MessageKey } from "../../i18n/messages/en-US/index";
import { zhCN } from "../../i18n/messages/zh-CN/index";
import { esES } from "../../i18n/messages/es-ES/index";
import { jaJP } from "../../i18n/messages/ja-JP/index";
import { runtimeClearVolatileCacheAndRestart, runtimeLogWrite } from "../../shared/api/runtime";
import { InfoHint } from "../../components/ui/info-hint";
import { clearRecoverableClientState } from "../utils/recoverableClientState";
import { writeTauriSmokeProgress } from "../smoke/tauriSmokeProgress";

type Props = {
  children: ReactNode;
};

type State = {
  errorMessage: string | null;
  crashCount: number;
};

const MESSAGE_MAP = {
  "en-US": enUS,
  "zh-CN": zhCN,
  "es-ES": esES,
  "ja-JP": jaJP,
};

type BootLocale = keyof typeof MESSAGE_MAP;

function detectBootLocale(): BootLocale {
  const stored = safeLocalStorageGet("latotex.locale");
  const raw = stored || (typeof navigator === "undefined" ? "" : navigator.language);
  if (raw.toLowerCase().startsWith("zh")) {
    return "zh-CN";
  }
  if (raw.toLowerCase().startsWith("es")) {
    return "es-ES";
  }
  if (raw.toLowerCase().startsWith("ja")) {
    return "ja-JP";
  }
  return "en-US";
}

function safeLocalStorageGet(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function bootText(key: MessageKey): string {
  const locale = detectBootLocale();
  return MESSAGE_MAP[locale][key] ?? enUS[key] ?? key;
}

function logBootFailure(message: string, detail?: string) {
  const payload = detail ? `${message}; ${detail}` : message;
  void runtimeLogWrite("ERROR", `react.root_boot_error: ${payload}`).catch(() => undefined);
  writeTauriSmokeProgress("frontend.root_error", "error", { message, detail });
}

export class RootBootErrorBoundary extends Component<Props, State> {
  state: State = {
    errorMessage: null,
    crashCount: 0,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      errorMessage: error?.message || String(error || "unknown error"),
    };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    const message = error?.message || String(error || "unknown error");
    const stack = String(info?.componentStack ?? "").replace(/\s+/g, " ").trim().slice(0, 1200);
    logBootFailure(message, `componentStack=${stack}`);
    this.setState((prev) => ({ crashCount: prev.crashCount + 1 }));
  }

  private handleRetry = () => {
    clearRecoverableClientState();
    this.setState({ errorMessage: null });
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  private handleCircuitBreak = () => {
    clearRecoverableClientState();
    void runtimeClearVolatileCacheAndRestart().catch(() => {
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    });
  };

  render() {
    if (!this.state.errorMessage) {
      return this.props.children;
    }
    return (
      <main className="app-material-canvas flex min-h-screen items-center justify-center p-6 text-[color:var(--app-text)]">
        <section className="app-material-floating w-full max-w-lg rounded-lg border p-5">
          <div className="flex items-center gap-1">
            <h1 className="text-base font-semibold text-[color:var(--app-status-danger)]">{bootText("workspace.bootCrashedTitle")}</h1>
            <InfoHint
              content={bootText("workspace.bootCrashedHint")}
              label={bootText("workspace.bootCrashedTitle")}
              tone="warning"
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="control-button control-button--secondary px-3 py-1.5 text-sm"
              onClick={this.handleRetry}
            >
              {bootText("workspace.bootCrashedRetry")}
            </button>
            <button
              type="button"
              className="control-button control-button--danger px-3 py-1.5 text-sm"
              onClick={this.handleCircuitBreak}
            >
              {bootText("workspace.circuitBreakerRestart")}
            </button>
          </div>
        </section>
      </main>
    );
  }
}

export function reportRootBootError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "unknown error");
  logBootFailure(message);
}
