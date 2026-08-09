// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../../shared/types/app";
import {
  emitOnboardingMilestone,
  ONBOARDING_PLAN_REVIEW_EVENT,
  ONBOARDING_RESEARCH_QUESTION_EVENT,
  startOnboarding,
} from "../onboarding/onboardingState";
import { useOnboardingController } from "./useOnboardingController";

function baseSettings(): AppSettings {
  return {
    activeProjectId: "sample",
    modelProtocols: [],
    modelCatalog: [],
    agentBindings: [],
    uiPrefs: { onboarding: startOnboarding("sample") },
  };
}

function OnboardingProbe(props: { onCompile: () => Promise<null> }) {
  const [settings, setSettings] = useState<AppSettings | null>(baseSettings());
  const controller = useOnboardingController({
    activeProjectId: "sample",
    setSettings,
    onCompile: props.onCompile,
  });
  return (
    <div>
      <button data-testid="goal" type="button" onClick={() => controller.saveProjectGoal("Verify the central claim")}>goal</button>
      <button data-testid="domain" type="button" onClick={() => controller.saveResearchDomain("life_sciences")}>domain</button>
      <button data-testid="privacy" type="button" onClick={controller.markResearchPrivacyReviewed}>privacy</button>
      <button data-testid="model" type="button" onClick={() => controller.recordStep("model")}>model</button>
      <button data-testid="compile" type="button" onClick={() => void controller.handleCompile()}>compile</button>
      <output data-testid="state">{JSON.stringify(settings)}</output>
    </div>
  );
}

describe("useOnboardingController", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("persists the project goal and domain while recording real setup milestones", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<OnboardingProbe onCompile={vi.fn().mockResolvedValue(null)} />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='goal']")?.click();
      container.querySelector<HTMLButtonElement>("[data-testid='domain']")?.click();
      container.querySelector<HTMLButtonElement>("[data-testid='privacy']")?.click();
      container.querySelector<HTMLButtonElement>("[data-testid='model']")?.click();
    });
    const state = container.querySelector("[data-testid='state']")?.textContent ?? "";
    expect(state).toContain('"researchGoalByProject":{"sample":"Verify the central claim"}');
    expect(state).toContain('"researchDomainByProject":{"sample":"life_sciences"}');
    expect(state).toContain('"researchPrivacyReviewedByProject":{"sample":true}');
    expect(state).toContain('"completedSteps":["goal","model"]');
    await act(async () => root.unmount());
  });

  it("records project-scoped question and plan-review events without coupling compile state", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onCompile = vi.fn().mockResolvedValue(null);
    await act(async () => root.render(<OnboardingProbe onCompile={onCompile} />));
    await act(async () => {
      emitOnboardingMilestone(ONBOARDING_RESEARCH_QUESTION_EVENT, "other");
      emitOnboardingMilestone(ONBOARDING_RESEARCH_QUESTION_EVENT, "sample");
      emitOnboardingMilestone(ONBOARDING_PLAN_REVIEW_EVENT, "sample");
      container.querySelector<HTMLButtonElement>("[data-testid='compile']")?.click();
      await Promise.resolve();
    });
    const state = container.querySelector("[data-testid='state']")?.textContent ?? "";
    expect(state).toContain('"completedSteps":["question","plan_review"]');
    expect(onCompile).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });
});
