import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { startTauriSmokeRunner } from "./app/smoke/tauriSmokeRunner";
import { I18nProvider, resolveLocale } from "./i18n";
import "./index.css";
import "./styles/control-system.css";

const bootLocale = resolveLocale(
  typeof window !== "undefined" ? window.localStorage.getItem("latotex.locale") : null
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider
      initialLocale={bootLocale}
      onLocaleChange={(locale) => {
        if (typeof window !== "undefined") {
          window.localStorage.setItem("latotex.locale", locale);
        }
      }}
    >
      <App />
    </I18nProvider>
  </React.StrictMode>
);

startTauriSmokeRunner();
