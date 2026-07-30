// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../../../shared/types/app";
import { AgentTeamsSettingsSection } from "./AgentTeamsSettingsSection";

function Harness(props: { onOpenAgentControl: () => void }) {
  const [settings, setSettings] = useState<AppSettings | null>({
    activeProjectId: null,
    modelProtocols: [],
    modelCatalog: [],
    agentBindings: [],
    uiPrefs: {},
  });
  if (!settings) {
    return null;
  }
  return (
    <AgentTeamsSettingsSection
      settings={settings}
      activeModelCatalog={[]}
      setSettings={setSettings}
      onOpenAgentControl={props.onOpenAgentControl}
      t={(key) => String(key)}
    />
  );
}

describe("AgentTeamsSettingsSection", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("routes the legacy settings entry to the Agent control center", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const onOpenAgentControl = vi.fn();
    await act(async () => {
      root.render(<Harness onOpenAgentControl={onOpenAgentControl} />);
    });

    const openButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("settings.openAgentControl"),
    );
    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenAgentControl).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector("[role='dialog']")).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
