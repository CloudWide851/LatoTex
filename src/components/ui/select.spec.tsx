// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Select } from "./select";

describe("Select", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("keeps the portal menu open long enough to commit an option click", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const handleChange = vi.fn();

    await act(async () => {
      root.render(
        <Select value="anthropic" onChange={handleChange}>
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
        </Select>,
      );
    });

    const trigger = container.querySelector("button[role='combobox']");
    expect(trigger).not.toBeNull();

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const option = document.body.querySelector("button[role='option'][aria-selected='false']");
    expect(option?.textContent).toContain("OpenAI");

    await act(async () => {
      option?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      option?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(handleChange.mock.calls[0]?.[0]?.target?.value).toBe("openai");
  });
});
