import { describe, expect, it } from "vitest";
import type { AppSettings } from "../../shared/types/app";
import {
  applyOnboardingEventToSettings,
  normalizeOnboardingState,
  normalizeResearchDomainByProject,
  normalizeResearchGoalByProject,
  normalizeResearchPrivacyReviewedByProject,
  reduceOnboarding,
  startOnboarding,
} from "./onboardingState";

function settings(): AppSettings {
  return {
    activeProjectId: null,
    modelProtocols: [],
    modelCatalog: [],
    agentBindings: [],
  };
}

describe("onboarding state", () => {
  it("does not start for existing users from ambient workspace events", () => {
    expect(reduceOnboarding(undefined, {
      type: "record",
      projectId: "existing",
      step: "goal",
    })).toBeUndefined();
  });

  it("records real steps once and completes only after all five", () => {
    const started = startOnboarding("sample");
    const domain = reduceOnboarding(started, {
      type: "record",
      projectId: "sample",
      step: "domain_privacy",
    });
    const goal = reduceOnboarding(domain, {
      type: "record",
      projectId: "sample",
      step: "goal",
    });
    const model = reduceOnboarding(goal, {
      type: "record",
      projectId: "sample",
      step: "model",
    });
    const question = reduceOnboarding(model, { type: "record", projectId: "sample", step: "question" });
    const completed = reduceOnboarding(question, { type: "record", projectId: "sample", step: "plan_review" });

    expect(goal?.completedSteps).toEqual(["goal", "domain_privacy"]);
    expect(completed).toMatchObject({
      status: "completed",
      completedSteps: ["goal", "domain_privacy", "model", "question", "plan_review"],
    });
    expect(reduceOnboarding(completed, {
      type: "record",
      projectId: "sample",
      step: "plan_review",
    })).toBe(completed);
  });

  it("scopes events to one project and supports dismiss plus replay", () => {
    const started = startOnboarding("sample");
    expect(reduceOnboarding(started, {
      type: "record",
      projectId: "other",
      step: "goal",
    })).toBe(started);

    const dismissed = reduceOnboarding(started, { type: "dismiss", projectId: "sample" });
    expect(dismissed?.status).toBe("dismissed");
    expect(reduceOnboarding(dismissed, {
      type: "restart",
      projectId: "sample",
    })).toEqual(startOnboarding("sample"));
  });

  it("persists a normalized versioned state inside UI preferences", () => {
    const next = applyOnboardingEventToSettings(settings(), {
      type: "restart",
      projectId: "sample",
    });
    expect(next.activeProjectId).toBe("sample");
    expect(normalizeOnboardingState(next.uiPrefs?.onboarding)).toEqual(startOnboarding("sample"));
    expect(normalizeOnboardingState({ version: 99, status: "active", completedSteps: [] })).toBeUndefined();
  });

  it("normalizes persisted research goals and domain values at the settings boundary", () => {
    expect(normalizeResearchGoalByProject({
      " sample ": "  Verify the claim  ",
      blank: "  ",
      invalid: 42,
    })).toEqual({ sample: "Verify the claim" });
    expect(normalizeResearchDomainByProject({
      " sample ": "life_sciences",
      invalid: "clinical",
      empty: "",
    })).toEqual({ sample: "life_sciences" });
    expect(normalizeResearchPrivacyReviewedByProject({
      " sample ": true,
      falseValue: false,
      invalid: "true",
    })).toEqual({ sample: true });
  });
});
