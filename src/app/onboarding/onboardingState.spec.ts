import { describe, expect, it } from "vitest";
import type { AppSettings } from "../../shared/types/app";
import {
  applyOnboardingEventToSettings,
  normalizeOnboardingState,
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
      step: "open",
    })).toBeUndefined();
  });

  it("records real steps once and completes only after all three", () => {
    const started = startOnboarding("sample");
    const compiled = reduceOnboarding(started, {
      type: "record",
      projectId: "sample",
      step: "compile",
    });
    const opened = reduceOnboarding(compiled, {
      type: "record",
      projectId: "sample",
      step: "open",
    });
    const completed = reduceOnboarding(opened, {
      type: "record",
      projectId: "sample",
      step: "view",
    });

    expect(opened?.completedSteps).toEqual(["open", "compile"]);
    expect(completed).toMatchObject({
      status: "completed",
      completedSteps: ["open", "compile", "view"],
    });
    expect(reduceOnboarding(completed, {
      type: "record",
      projectId: "sample",
      step: "view",
    })).toBe(completed);
  });

  it("scopes events to one project and supports dismiss plus replay", () => {
    const started = startOnboarding("sample");
    expect(reduceOnboarding(started, {
      type: "record",
      projectId: "other",
      step: "open",
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
});
