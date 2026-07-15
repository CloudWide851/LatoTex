// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  channelsEmailFetchSubmission,
  channelsEmailPasswordSaveVerified,
  channelsEmailTest,
} from "../../../shared/api/share";
import type { AppSettings } from "../../../shared/types/app";
import { persistSettingsNow } from "../../settings/settingsPersistenceBridge";
import { EmailChannelSettingsCard } from "./EmailChannelSettingsCard";

vi.mock("../../../shared/api/share", () => ({
  channelsEmailFetchSubmission: vi.fn(),
  channelsEmailPasswordSaveVerified: vi.fn(),
  channelsEmailTest: vi.fn(),
}));

vi.mock("../../settings/settingsPersistenceBridge", () => ({
  SETTINGS_PERSISTENCE_UNAVAILABLE: "settings.persistence.unavailable",
  persistSettingsNow: vi.fn(),
}));

const messages: Record<string, string> = {
  "common.loading": "Loading",
  "settings.channels.email": "Submission Email",
  "settings.channels.emailDescription": "Secure inbox settings",
  "settings.channels.emailEnabled": "Enable email intake",
  "settings.channels.emailSync": "Sync inbox",
  "settings.channels.emailAddress": "Email address",
  "settings.channels.emailPassword": "App password",
  "settings.channels.emailPasswordPlaceholder": "Secure storage only",
  "settings.channels.emailImapHost": "IMAP host",
  "settings.channels.emailPort": "Port",
  "settings.channels.emailSecurity": "Security",
  "settings.channels.emailSecurity.tls": "TLS",
  "settings.channels.emailSecurity.starttls": "STARTTLS",
  "settings.channels.emailSecurity.plain": "Plain (unencrypted)",
  "settings.channels.emailPlainWarning": "Credentials will be sent without transport encryption.",
  "settings.channels.emailAdvancedShow": "Show advanced IMAP settings",
  "settings.channels.emailAdvancedHide": "Hide advanced IMAP settings",
  "settings.channels.emailMaxResults": "Result limit",
  "settings.channels.emailUsername": "Username",
  "settings.channels.emailUsernamePlaceholder": "Defaults to email",
  "settings.channels.emailMailbox": "Mailbox",
  "settings.channels.emailKeywords": "Submission keywords",
  "settings.channels.emailKeywordsPlaceholder": "submission, decision",
  "settings.channels.emailSavePassword": "Save password",
  "settings.channels.emailPasswordSaved": "Password saved",
  "settings.channels.emailSavingSettings": "Saving current settings…",
  "settings.channels.emailTest": "Test inbox",
  "settings.channels.emailTestOk": "Inbox verified",
  "settings.channels.emailSyncOk": "{count} items",
  "settings.channels.emailSyncEmpty": "No matches",
};

const t = (key: any) => messages[String(key)] ?? String(key);

function createSettings(security = "tls"): AppSettings {
  return {
    activeProjectId: "project-1",
    modelProtocols: [],
    modelCatalog: [],
    agentBindings: [],
    uiPrefs: {
      channels: {
        emailEnabled: true,
        emailAddress: "author@example.test",
        emailImapHost: "imap.example.test",
        emailSecurity: security,
      },
    },
  };
}

async function renderCard(settings = createSettings()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <EmailChannelSettingsCard
        settings={settings}
        setChannelField={vi.fn()}
        formatError={(raw) => raw === "settings.persistence.unavailable" ? "Settings unavailable" : raw}
        t={t}
      />,
    );
  });
  return { container, root };
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.includes(label),
  );
}

describe("EmailChannelSettingsCard", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(persistSettingsNow).mockReset();
    vi.mocked(channelsEmailPasswordSaveVerified).mockReset();
    vi.mocked(channelsEmailTest).mockReset();
    vi.mocked(channelsEmailFetchSubmission).mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("persists settings before saving a password and testing the inbox", async () => {
    const settings = createSettings();
    const order: string[] = [];
    vi.mocked(persistSettingsNow).mockImplementation(async () => {
      order.push("persist");
      return settings;
    });
    vi.mocked(channelsEmailPasswordSaveVerified).mockImplementation(async () => {
      order.push("password");
      return { ok: true, message: "saved" };
    });
    vi.mocked(channelsEmailTest).mockImplementation(async () => {
      order.push("test");
      return { ok: true, message: "verified" };
    });
    const view = await renderCard(settings);
    const passwordInput = view.container.querySelector<HTMLInputElement>('input[type="password"]');

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(passwordInput, "app-password");
      passwordInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      findButton(view.container, "Test inbox")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(order).toEqual(["persist", "password", "test"]);
    expect(persistSettingsNow).toHaveBeenCalledWith(settings);
    expect(channelsEmailPasswordSaveVerified).toHaveBeenCalledWith({ password: "app-password" });
    expect(view.container.querySelector('[role="status"]')?.textContent).toBe("Inbox verified");

    await act(async () => view.root.unmount());
  });

  it("short-circuits connection actions when settings persistence fails", async () => {
    vi.mocked(persistSettingsNow).mockRejectedValue("settings.persistence.unavailable");
    const view = await renderCard();

    await act(async () => {
      findButton(view.container, "Test inbox")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(channelsEmailPasswordSaveVerified).not.toHaveBeenCalled();
    expect(channelsEmailTest).not.toHaveBeenCalled();
    expect(view.container.querySelector('[role="alert"]')?.textContent).toBe("Settings unavailable");

    await act(async () => view.root.unmount());
  });

  it("keeps test and sync mutually exclusive while persistence is in flight", async () => {
    const settings = createSettings();
    let releasePersistence: (() => void) | undefined;
    const persistenceGate = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    vi.mocked(persistSettingsNow).mockImplementation(async () => {
      await persistenceGate;
      return settings;
    });
    vi.mocked(channelsEmailTest).mockResolvedValue({ ok: true, message: "verified" });
    vi.mocked(channelsEmailFetchSubmission).mockResolvedValue({ status: "ok", items: [] });
    const view = await renderCard(settings);
    const testButton = findButton(view.container, "Test inbox");
    const syncButton = findButton(view.container, "Sync inbox");

    act(() => {
      testButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      syncButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(persistSettingsNow).toHaveBeenCalledOnce();
    expect(channelsEmailFetchSubmission).not.toHaveBeenCalled();

    await act(async () => {
      releasePersistence?.();
      await persistenceGate;
      await Promise.resolve();
    });

    expect(channelsEmailTest).toHaveBeenCalledOnce();
    expect(channelsEmailFetchSubmission).not.toHaveBeenCalled();

    await act(async () => view.root.unmount());
  });

  it("persists before sync and exposes plaintext risk with advanced settings open", async () => {
    const settings = createSettings("plain");
    const order: string[] = [];
    vi.mocked(persistSettingsNow).mockImplementation(async () => {
      order.push("persist");
      return settings;
    });
    vi.mocked(channelsEmailFetchSubmission).mockImplementation(async () => {
      order.push("sync");
      return { status: "channels.email.no_matches", items: [] };
    });
    const view = await renderCard(settings);

    expect(view.container.querySelector('[aria-controls="email-advanced-settings"]')?.getAttribute("aria-expanded")).toBe("true");
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("without transport encryption");

    await act(async () => {
      findButton(view.container, "Sync inbox")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(order).toEqual(["persist", "sync"]);
    expect(channelsEmailFetchSubmission).toHaveBeenCalledWith({ limit: 20 });

    await act(async () => view.root.unmount());
  });
});
