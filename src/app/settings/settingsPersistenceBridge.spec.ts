import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../../shared/types/app";
import {
  persistSettingsNow,
  registerSettingsPersistence,
  SETTINGS_PERSISTENCE_UNAVAILABLE,
} from "./settingsPersistenceBridge";

const settings = {
  activeProjectId: null,
  modelProtocols: [],
  modelCatalog: [],
  agentBindings: [],
} satisfies AppSettings;

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("settingsPersistenceBridge", () => {
  it("rejects with a stable diagnostic when no persistence owner is mounted", async () => {
    await expect(persistSettingsNow(settings)).rejects.toBe(SETTINGS_PERSISTENCE_UNAVAILABLE);
  });

  it("forwards the current settings snapshot and result", async () => {
    const updated = { ...settings, activeProjectId: "project-1" };
    const handler = vi.fn().mockResolvedValue(updated);
    cleanups.push(registerSettingsPersistence(handler));

    await expect(persistSettingsNow(settings)).resolves.toBe(updated);
    expect(handler).toHaveBeenCalledWith(settings);
  });

  it("does not let stale cleanup unregister a newer owner", async () => {
    const first = vi.fn().mockResolvedValue(settings);
    const second = vi.fn().mockResolvedValue(settings);
    const cleanupFirst = registerSettingsPersistence(first);
    const cleanupSecond = registerSettingsPersistence(second);
    cleanups.push(cleanupSecond);

    cleanupFirst();
    await persistSettingsNow(settings);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
