import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { reportRootBootError, RootBootErrorBoundary } from "./app/components/RootBootErrorBoundary";
import { startTauriSmokeRunner } from "./app/smoke/tauriSmokeRunner";
import { writeTauriSmokeProgress } from "./app/smoke/tauriSmokeProgress";
import { I18nProvider, resolveLocale } from "./i18n";
import "./index.css";
import "./styles/control-system.css";

if (typeof window !== "undefined") {
  (window as Window & { __latotexBootStartedAt?: number }).__latotexBootStartedAt = performance.now();
}

function safeStoredLocale(): string | null {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem("latotex.locale") : null;
  } catch (error) {
    reportRootBootError(error);
    return null;
  }
}

function safePersistLocale(locale: string) {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("latotex.locale", locale);
    }
  } catch (error) {
    reportRootBootError(error);
  }
}

function isBenignWindowError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message === "ResizeObserver loop completed with undelivered notifications."
    || message === "ResizeObserver loop limit exceeded";
}

function prepareBootSmokeScenario() {
  if (typeof window === "undefined") {
    return;
  }
  const scenario = new URLSearchParams(window.location.search).get("latotexSmokeScenario");
  if (scenario !== "polluted-client-state") {
    return;
  }
  try {
    window.localStorage.setItem("latotex.workspace.page", "latex");
    window.localStorage.setItem("latotex.latex.workspace.session.smoke", JSON.stringify({
      selectedFile: ".gitignore",
      activeTabId: ".gitignore",
      editorTabs: [{ id: ".gitignore", path: ".gitignore" }],
    }));
    writeTauriSmokeProgress("frontend.boot_smoke_scenario", "ok", { scenario });
  } catch (error) {
    reportRootBootError(error);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    const error = event.error ?? event.message;
    if (!isBenignWindowError(error)) {
      reportRootBootError(error);
    }
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (!isBenignWindowError(event.reason)) {
      reportRootBootError(event.reason);
    }
  });
}

try {
  writeTauriSmokeProgress("frontend.entry", "ok", { href: typeof window === "undefined" ? "" : window.location.href });
  prepareBootSmokeScenario();
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("root element is missing");
  }
  const bootLocale = resolveLocale(safeStoredLocale());
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <RootBootErrorBoundary>
        <I18nProvider
          initialLocale={bootLocale}
          onLocaleChange={(locale) => {
            safePersistLocale(locale);
          }}
        >
          <App />
        </I18nProvider>
      </RootBootErrorBoundary>
    </React.StrictMode>
  );
  writeTauriSmokeProgress("frontend.render_scheduled", "ok", { locale: bootLocale });
} catch (error) {
  reportRootBootError(error);
}

startTauriSmokeRunner();
