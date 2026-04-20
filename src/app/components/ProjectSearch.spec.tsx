// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectSearchHit } from "../../shared/types/app";
import { ProjectSearch } from "./ProjectSearch";

const translations: Record<string, string> = {
  "topbar.searchPlaceholder": "Search files and content in this project",
  "topbar.searching": "Searching...",
  "topbar.noSearchResults": "No matches found.",
  "topbar.clearSearch": "Clear search",
  "topbar.searchGroupFiles": "Files",
  "topbar.searchGroupContent": "Content",
  "topbar.searchGroupSessions": "Sessions",
  "topbar.searchScopeFileName": "File name",
  "topbar.searchScopeContent": "File content",
  "topbar.searchScopeSessions": "Session name",
  "topbar.searchFileNameMatch": "File name match",
  "topbar.searchSessionMatch": "Session title match",
};

describe("ProjectSearch", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("starts searching automatically while typing and renders the result surface in a portal", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSearch = vi.fn();
    const onSelect = vi.fn();
    const onClear = vi.fn();
    const onQueryChange = vi.fn();
    const hit: ProjectSearchHit = {
      relativePath: "src/main.tex",
      lineNumber: 12,
      snippet: "content preview",
      matchKind: "file_content",
    };

    await act(async () => {
      root.render(
        <ProjectSearch
          query="main"
          onQueryChange={onQueryChange}
          searching={false}
          searched={false}
          results={[]}
          onSearch={onSearch}
          onSelect={onSelect}
          onClear={onClear}
          t={(key) => translations[String(key)] ?? String(key)}
        />,
      );
    });

    expect(document.body.textContent).toContain("Searching...");

    await act(async () => {
      vi.advanceTimersByTime(220);
    });
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith(["file_name", "file_content", "chat_session"]);

    await act(async () => {
      root.render(
        <ProjectSearch
          query="main"
          onQueryChange={onQueryChange}
          searching={false}
          searched
          results={[hit]}
          onSearch={onSearch}
          onSelect={onSelect}
          onClear={onClear}
          t={(key) => translations[String(key)] ?? String(key)}
        />,
      );
    });

    expect(document.body.querySelector(".control-menu-surface")).not.toBeNull();
    expect(container.querySelector(".control-menu-surface")).toBeNull();

    const resultButton = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("src/main.tex:12"),
    );
    expect(resultButton).toBeTruthy();

    await act(async () => {
      resultButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith(hit);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
