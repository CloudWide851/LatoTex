import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { SharePageShell } from "./SharePageShell";

async function bootstrap() {
  const rootNode = document.getElementById("share-root");
  if (!rootNode) {
    return;
  }
  const i18nModuleUrl = "/assets/share_page_i18n.js";
  const appModuleUrl = "/assets/share_page_app.js";
  const { createI18n, detectDevice, detectLocale } = await import(/* @vite-ignore */ i18nModuleUrl) as {
    createI18n: (locale: string) => Record<string, unknown>;
    detectDevice: (preferred?: string | null) => "desktop" | "mobile";
    detectLocale: (preferred?: string | null) => string;
  };
  const params = new URLSearchParams(window.location.search);
  const locale = detectLocale(params.get("lang") || params.get("locale"));
  const device = detectDevice(params.get("device") || params.get("layout"));
  const root = createRoot(rootNode);
  flushSync(() => {
    root.render(
      <React.StrictMode>
        <SharePageShell mobile={device === "mobile"} />
      </React.StrictMode>,
    );
  });
  const { bootstrapSharePage } = await import(/* @vite-ignore */ appModuleUrl) as {
    bootstrapSharePage: (options?: {
      device?: "desktop" | "mobile";
      locale?: string;
      i18n?: Record<string, unknown>;
    }) => Promise<void>;
  };
  await bootstrapSharePage({
    device,
    locale,
    i18n: createI18n(locale),
  });
}

void bootstrap();
