import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  requestSettingsSection,
  subscribeSettingsSectionRequests,
} from "./settingsNavigation";

const cleanups: Array<() => void> = [];

beforeEach(() => {
  const drain = subscribeSettingsSectionRequests(() => undefined);
  drain();
});

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("settingsNavigation", () => {
  it("delivers the latest queued section when Settings mounts", () => {
    requestSettingsSection("general");
    requestSettingsSection("channels");
    const listener = vi.fn();

    cleanups.push(subscribeSettingsSectionRequests(listener));

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith("channels");
  });

  it("delivers new requests to a mounted subscriber without replay", () => {
    const listener = vi.fn();
    cleanups.push(subscribeSettingsSectionRequests(listener));

    requestSettingsSection("channels");

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith("channels");
  });

  it("removes only the listener owned by its cleanup", () => {
    const first = vi.fn();
    const second = vi.fn();
    const cleanupFirst = subscribeSettingsSectionRequests(first);
    cleanups.push(subscribeSettingsSectionRequests(second));

    cleanupFirst();
    requestSettingsSection("channels");

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("channels");
  });
});
