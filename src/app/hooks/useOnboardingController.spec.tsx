// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../../shared/types/app";
import { applyOnboardingEventToSettings, startOnboarding } from "../onboarding/onboardingState";
import { useOnboardingController } from "./useOnboardingController";

function baseSettings(): AppSettings {
  return {
    activeProjectId: "sample",
    modelProtocols: [],
    modelCatalog: [],
    agentBindings: [],
  };
}

function OnboardingProbe(props: {
  initialSettings: AppSettings;
  selectedPath: string;
  onCompile: () => Promise<{
    status: string;
    diagnostics: string[];
    pdfRelativePath: string | null;
    pdfUrl: string | null;
  } | null>;
}) {
  const [settings, setSettings] = useState<AppSettings | null>(props.initialSettings);
  const controller = useOnboardingController({
    activeProjectId: "sample",
    selectedTextFileReadyPath: props.selectedPath,
    onboarding: settings?.uiPrefs?.onboarding,
    setSettings,
    onCompile: props.onCompile,
  });

  return (
    <div>
      <button
        data-testid="restart"
        type="button"
        onClick={() => setSettings((current) => current
          ? applyOnboardingEventToSettings(current, {
              type: "restart",
              projectId: "sample",
            })
          : current)}
      >
        restart
      </button>
      <button data-testid="compile" type="button" onClick={() => void controller.handleCompile()}>
        compile
      </button>
      <button data-testid="view" type="button" onClick={controller.handlePdfViewed}>
        view
      </button>
      <output data-testid="state">{JSON.stringify(settings?.uiPrefs?.onboarding ?? null)}</output>
    </div>
  );
}

describe("useOnboardingController", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("records an already-open main.tex after the guide is replayed", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const initialSettings = {
      ...baseSettings(),
      uiPrefs: {
        onboarding: { ...startOnboarding("sample"), status: "dismissed" as const },
      },
    };

    await act(async () => {
      root.render(
        <OnboardingProbe
          initialSettings={initialSettings}
          selectedPath="main.tex"
          onCompile={vi.fn().mockResolvedValue(null)}
        />,
      );
    });
    expect(container.querySelector("[data-testid='state']")?.textContent).toContain('"status":"dismissed"');

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='restart']")?.click();
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='state']")?.textContent).toContain('"completedSteps":["open"]');
    await act(async () => root.unmount());
  });

  it("records compile only after success and records a real PDF load", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onCompile = vi.fn()
      .mockResolvedValueOnce({ status: "failed", diagnostics: [], pdfRelativePath: null, pdfUrl: null })
      .mockResolvedValueOnce({ status: "success", diagnostics: [], pdfRelativePath: "main.pdf", pdfUrl: "blob:pdf" });
    const initialSettings = {
      ...baseSettings(),
      uiPrefs: { onboarding: startOnboarding("sample") },
    };

    await act(async () => {
      root.render(
        <OnboardingProbe
          initialSettings={initialSettings}
          selectedPath="notes.tex"
          onCompile={onCompile}
        />,
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='compile']")?.click();
      await Promise.resolve();
    });
    expect(container.querySelector("[data-testid='state']")?.textContent).toContain('"completedSteps":[]');

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='compile']")?.click();
      await Promise.resolve();
      container.querySelector<HTMLButtonElement>("[data-testid='view']")?.click();
    });
    expect(container.querySelector("[data-testid='state']")?.textContent).toContain('"completedSteps":["compile","view"]');
    await act(async () => root.unmount());
  });
});
