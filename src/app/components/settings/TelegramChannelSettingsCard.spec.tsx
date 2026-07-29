// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../../../shared/types/app";
import { TelegramChannelSettingsCard } from "./TelegramChannelSettingsCard";
import {
  channelsTelegramTest,
  channelsTelegramTokenSaveVerified,
} from "../../../shared/api/share";
import { persistSettingsNow } from "../../settings/settingsPersistenceBridge";

vi.mock("../../../shared/api/share", () => ({
  channelsTelegramTest: vi.fn(),
  channelsTelegramTokenClear: vi.fn(),
  channelsTelegramTokenSaveVerified: vi.fn(),
}));

vi.mock("../../settings/settingsPersistenceBridge", () => ({
  SETTINGS_PERSISTENCE_UNAVAILABLE: "settings.persistence.unavailable",
  persistSettingsNow: vi.fn(),
}));

const mockedPersistSettingsNow = vi.mocked(persistSettingsNow);
const mockedTelegramTest = vi.mocked(channelsTelegramTest);
const mockedTokenSave = vi.mocked(channelsTelegramTokenSaveVerified);
const t = (key: string) => key;

function settings(tokenStored = true): AppSettings {
  return {
    activeProjectId: null,
    modelProtocols: [],
    modelCatalog: [],
    agentBindings: [],
    uiPrefs: {
      channels: {
        telegramEnabled: false,
        telegramTokenStored: tokenStored,
        telegramProxyMode: "system",
      },
    },
  };
}

describe("TelegramChannelSettingsCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockedPersistSettingsNow.mockResolvedValue(settings());
    mockedTokenSave.mockResolvedValue({ ok: true, message: "stored" });
    mockedTelegramTest.mockResolvedValue({
      ok: true,
      code: "ok",
      stage: "complete",
      retryable: false,
      proxySource: "wininet",
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    vi.clearAllMocks();
  });

  it("renders stored credentials as masked state without reading a token", async () => {
    await act(async () => {
      root.render(
        <TelegramChannelSettingsCard
          settings={settings(true)}
          setChannelField={vi.fn()}
          formatError={(raw) => raw}
          t={t}
        />,
      );
    });

    const tokenInput = container.querySelector<HTMLInputElement>('input[type="password"]');
    expect(tokenInput?.value).toBe("");
    expect(tokenInput?.placeholder).toBe("settings.channels.telegramTokenReplacePlaceholder");
    expect(container.textContent).toContain("settings.channels.telegramTokenStored");
    expect(container.textContent).not.toContain("legacy-placeholder");
  });

  it("persists settings, securely replaces the token, then verifies while disabled", async () => {
    const setChannelField = vi.fn();
    const currentSettings = settings(false);
    await act(async () => {
      root.render(
        <TelegramChannelSettingsCard
          settings={currentSettings}
          setChannelField={setChannelField}
          formatError={(raw) => raw}
          t={t}
        />,
      );
    });
    const tokenInput = container.querySelector<HTMLInputElement>('input[type="password"]');
    expect(tokenInput).not.toBeNull();
    await act(async () => {
      if (!tokenInput) return;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(tokenInput, "rotated-placeholder");
      tokenInput.dispatchEvent(new Event("input", { bubbles: true }));
      tokenInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const verifyButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("settings.channels.telegramSaveAndVerify"));
    expect(verifyButton).toBeDefined();
    await act(async () => {
      verifyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mockedPersistSettingsNow).toHaveBeenCalledWith(currentSettings);
    expect(mockedTokenSave).toHaveBeenCalledWith({ token: "rotated-placeholder" });
    expect(mockedTelegramTest).toHaveBeenCalledWith({
      text: "settings.channels.telegramTestMessage",
    });
    expect(setChannelField).toHaveBeenCalledWith({ telegramTokenStored: true });
    expect(container.textContent).toContain("settings.channels.telegramVerifyOk");
  });
});
