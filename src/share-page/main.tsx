import React from "react";
import { createRoot } from "react-dom/client";
import { SharePageShell } from "./SharePageShell";
import { detectShareDevice, detectShareLocale } from "./shareMessages";

async function bootstrap() {
  const rootNode = document.getElementById("share-root");
  if (!rootNode) {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  const locale = detectShareLocale(params.get("lang") || params.get("locale"));
  const device = detectShareDevice(params.get("device") || params.get("layout"));
  const root = createRoot(rootNode);
  root.render(
    <React.StrictMode>
      <SharePageShell device={device} locale={locale} />
    </React.StrictMode>,
  );
}

void bootstrap();
