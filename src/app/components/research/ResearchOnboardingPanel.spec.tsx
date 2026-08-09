// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../../../shared/types/app";
import { startOnboarding } from "../../onboarding/onboardingState";
import { ResearchOnboardingPanel } from "./ResearchOnboardingPanel";

function settings(privacyReviewed: boolean): AppSettings {
  return {
    activeProjectId: "project-1",
    modelProtocols: [],
    modelCatalog: [],
    agentBindings: [],
    uiPrefs: {
      onboarding: startOnboarding("project-1"),
      researchDomainByProject: { "project-1": "life_sciences" },
      researchPrivacyReviewedByProject: privacyReviewed ? { "project-1": true } : {},
    },
  };
}

describe("ResearchOnboardingPanel", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("completes domain and privacy only after an explicit project-scoped review", async () => {
    const onRecordStep = vi.fn();
    const renderPanel = (privacyReviewed: boolean) => (
      <ResearchOnboardingPanel
        projectId="project-1"
        settings={settings(privacyReviewed)}
        modelConfigured={false}
        privacyReviewed={privacyReviewed}
        questionAsked={false}
        planAvailable={false}
        onDismiss={vi.fn()}
        onRestart={vi.fn()}
        onRecordStep={onRecordStep}
        onResearchDomainChange={vi.fn()}
        onOpenPrivacy={vi.fn()}
        onOpenModels={vi.fn()}
        onOpenAgent={vi.fn()}
        t={(key) => String(key)}
      />
    );

    await act(async () => root.render(renderPanel(false)));
    expect(onRecordStep).not.toHaveBeenCalledWith("domain_privacy");

    await act(async () => root.render(renderPanel(true)));
    expect(onRecordStep).toHaveBeenCalledWith("domain_privacy");
  });
});
