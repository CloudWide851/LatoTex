// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyExternalSettingsSectionRequest,
  buildSettingsNavigationProjection,
  SettingsNavigation,
} from "./SettingsNavigation";

const labels: Record<string, string> = {
  "settings.navigation.search": "Search settings",
  "settings.navigation.noMatches": "No matching settings",
  "settings.navigation.compactLabel": "Settings section",
  "settings.navigation.group.workspace": "Workspace",
  "settings.navigation.group.intelligence": "Intelligence",
  "settings.navigation.group.extensions": "Extensions",
  "settings.navigation.group.support": "Support",
  "settings.section.general": "General",
  "settings.section.appearance": "Appearance",
  "settings.section.models": "Model Management",
  "settings.section.agents": "Agent Routing",
  "settings.section.agentTeams": "Agent Teams",
  "settings.section.agentTools": "Agent Tools",
  "settings.section.agentPermissions": "Agent Permissions",
  "settings.section.pluginSources": "Plugin Sources",
  "settings.section.mcp": "MCP",
  "settings.section.skills": "Skills",
  "settings.section.channels": "Channels",
  "settings.section.doctor": "Doctor",
  "settings.section.diagnostics": "Diagnostics",
  "settings.navigation.keywords.general": "language locale terminal project tray behavior",
  "settings.navigation.keywords.appearance": "theme color accent wallpaper glass motion font",
  "settings.navigation.keywords.models": "model provider api protocol catalog",
  "settings.navigation.keywords.agents": "agent routing binding model",
  "settings.navigation.keywords.agent-teams": "team multi-agent roles orchestration",
  "settings.navigation.keywords.agent-tools": "tools web python workspace search",
  "settings.navigation.keywords.agent-permissions": "permissions approval access safety",
  "settings.navigation.keywords.plugin-sources": "plugins marketplace source install",
  "settings.navigation.keywords.mcp": "mcp server tools protocol",
  "settings.navigation.keywords.skills": "skills prompts instructions",
  "settings.navigation.keywords.channels": "email telegram proxy submission mailbox",
  "settings.navigation.keywords.doctor": "doctor repair dependencies health",
  "settings.navigation.keywords.diagnostics": "diagnostics logs runtime debug",
};
const t = (key: any) => labels[String(key)] ?? String(key);

describe("SettingsNavigation", () => {
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
  });

  it("groups sections and filters by label or operational keyword", () => {
    const allSections = buildSettingsNavigationProjection("", t)
      .flatMap((group) => group.sections.map((item) => item.id));
    expect(allSections).toHaveLength(13);
    expect(new Set(allSections).size).toBe(13);
    const groups = buildSettingsNavigationProjection("mailbox", t);
    expect(groups.flatMap((group) => group.sections.map((item) => item.id))).toEqual(["channels"]);
    expect(buildSettingsNavigationProjection("Appearance", t)[0]?.sections[0]?.id).toBe("appearance");
  });

  it("matches localized operational synonyms in Chinese, Spanish, and Japanese", () => {
    const localized = {
      "settings.navigation.keywords.appearance": "主题 壁纸 磨砂",
      "settings.navigation.keywords.channels": "correo buzón envío",
      "settings.navigation.keywords.agent-permissions": "権限 承認 安全",
    };
    const localizedT: typeof t = (key) =>
      localized[String(key) as keyof typeof localized] ?? labels[String(key)] ?? String(key);

    expect(buildSettingsNavigationProjection("壁纸", localizedT)[0]?.sections[0]?.id).toBe("appearance");
    expect(buildSettingsNavigationProjection("buzón", localizedT)[0]?.sections[0]?.id).toBe("channels");
    expect(buildSettingsNavigationProjection("権限", localizedT)[0]?.sections[0]?.id).toBe("agent-permissions");
  });

  it("keeps the selected section in the compact projection while filtering", async () => {
    await act(async () => {
      root.render(
        <SettingsNavigation
          selectedSection="diagnostics"
          query="models"
          onQueryChange={vi.fn()}
          onSectionChange={vi.fn()}
          t={t}
        />,
      );
    });

    const values = Array.from(container.querySelectorAll("option")).map((option) => option.value);
    expect(values).toEqual(["diagnostics", "models"]);
    expect(container.querySelector('button[aria-current="page"]')).toBeNull();
  });

  it("clears a hiding filter before applying an external section request", () => {
    const clearQuery = vi.fn();
    const onSectionChange = vi.fn();
    applyExternalSettingsSectionRequest("channels", clearQuery, onSectionChange);
    expect(clearQuery).toHaveBeenCalledTimes(1);
    expect(onSectionChange).toHaveBeenCalledWith("channels");
  });
});
