// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppSettings } from "../../../shared/types/app";
import { startOnboarding } from "../../onboarding/onboardingState";
import { OnboardingSettingsCard } from "./OnboardingSettingsCard";

const messages: Record<string, string> = {
  "settings.onboardingTitle": "Quick start guide",
  "settings.onboardingDescription": "Replay the optional guide.",
  "settings.onboardingReplay": "Replay quick start",
  "settings.onboardingNoProject": "Open a project first.",
  "settings.onboardingReady": "Ready for the active project.",
  "settings.onboardingActive": "Guide active.",
  "settings.onboardingCompleted": "Guide completed.",
};

function SettingsCardProbe() {
  const [settings, setSettings] = useState<AppSettings | null>({
    activeProjectId: "active",
    modelProtocols: [],
    modelCatalog: [],
    agentBindings: [],
    uiPrefs: {
      onboarding: {
        ...startOnboarding("other"),
        status: "completed",
        completedSteps: ["goal", "domain_privacy", "model", "question", "plan_review"],
      },
    },
  });
  if (!settings) {
    return null;
  }
  return (
    <>
      <OnboardingSettingsCard
        activeProjectId="active"
        settings={settings}
        setSettings={setSettings}
        t={(key) => messages[String(key)] ?? String(key)}
      />
      <output data-testid="state">{JSON.stringify(settings.uiPrefs?.onboarding)}</output>
    </>
  );
}

describe("OnboardingSettingsCard", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("scopes status to the active project and replays on demand", async () => {
    await act(async () => root.render(<SettingsCardProbe />));
    expect(container.textContent).toContain("Ready for the active project.");
    expect(container.textContent).not.toContain("Guide completed.");

    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    expect(container.querySelector("[data-testid='state']")?.textContent).toContain('"projectId":"active"');
    expect(container.querySelector("[data-testid='state']")?.textContent).toContain('"status":"active"');
  });
});
