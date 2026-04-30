// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppSettings } from "../../../shared/types/app";
import { AgentTeamsSettingsSection } from "./AgentTeamsSettingsSection";

function Harness() {
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

  it("opens team editing in a dialog and switches to role editing inside the dialog", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<Harness />);
    });

    const editButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("settings.agentTeamsEdit"),
    );
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = container.querySelector("[role='dialog']");
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("settings.agentTeamsEditorTitle");

    const roleButton = Array.from(dialog?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent?.includes("settings.agentTeamsOpenRole"),
    );
    await act(async () => {
      roleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector("[role='dialog']")?.textContent).toContain(
      "settings.agentTeamsRoleConfigTitle",
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
