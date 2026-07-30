// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  isValidUnpaywallContactEmail,
  UnpaywallContactSettingsField,
} from "./UnpaywallContactSettingsField";

describe("UnpaywallContactSettingsField", () => {
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    container?.remove();
    container = null;
  });

  it("matches the bounded contact-email policy", () => {
    expect(isValidUnpaywallContactEmail("")).toBe(true);
    expect(isValidUnpaywallContactEmail("researcher@example.org")).toBe(true);
    expect(isValidUnpaywallContactEmail("invalid")).toBe(false);
    expect(isValidUnpaywallContactEmail("a@@example.org")).toBe(false);
    expect(isValidUnpaywallContactEmail("a @example.org")).toBe(false);
  });

  it("announces an invalid saved contact address", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const messages: Record<string, string> = {
      "settings.unpaywallContactEmail": "Contact email",
      "settings.unpaywallContactEmailHint": "Optional provider contact.",
      "settings.unpaywallContactEmailPlaceholder": "researcher@example.org",
      "settings.unpaywallContactEmailInvalid": "Invalid contact email.",
    };

    function Harness() {
      const [value, setValue] = useState("invalid");
      return (
        <UnpaywallContactSettingsField
          value={value}
          onChange={setValue}
          t={(key) => messages[key] ?? key}
        />
      );
    }

    act(() => root.render(<Harness />));
    const input = container?.querySelector("input");
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    expect(container?.querySelector('[role="alert"]')?.textContent).toBe("Invalid contact email.");
    act(() => root.unmount());
  });
});
