// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelModal } from "./ModelModal";

function setInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ModelModal", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("updates the protocol base url while preserving model names and api key", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ModelModal
          open
          mode="create"
          initialModel={null}
          protocols={[
            {
              id: "openai-compatible",
              displayName: "OpenAI-Compatible",
              baseUrl: "https://api.openai.com/v1",
              apiKeySet: false,
            },
            {
              id: "anthropic",
              displayName: "Anthropic",
              baseUrl: "https://api.anthropic.com",
              apiKeySet: false,
            },
          ]}
          onClose={() => undefined}
          onGetModelApiKey={async () => ""}
          onSubmit={async () => ({ ok: true })}
          t={(key) => String(key)}
        />,
      );
    });

    const inputs = container.querySelectorAll("input");
    const baseUrlInput = inputs[0] as HTMLInputElement;
    const modelDisplayNameInput = inputs[1] as HTMLInputElement;
    const modelRequestNameInput = inputs[2] as HTMLInputElement;
    const apiKeyInput = inputs[3] as HTMLInputElement;
    const protocolTrigger = container.querySelector("button[role='combobox']");

    await act(async () => {
      setInputValue(modelDisplayNameInput, "Claude 3.7");
      setInputValue(modelRequestNameInput, "claude-3-7-sonnet");
      setInputValue(apiKeyInput, "secret-key");
    });

    expect(baseUrlInput.value).toBe("https://api.openai.com/v1");

    await act(async () => {
      protocolTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const anthropicOption = Array.from(document.body.querySelectorAll("button[role='option']"))
      .find((element) => element.textContent?.includes("Anthropic"));

    await act(async () => {
      anthropicOption?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const nextInputs = container.querySelectorAll("input");
    expect((nextInputs[0] as HTMLInputElement).value).toBe("https://api.anthropic.com");
    expect((nextInputs[1] as HTMLInputElement).value).toBe("Claude 3.7");
    expect((nextInputs[2] as HTMLInputElement).value).toBe("claude-3-7-sonnet");
    expect((nextInputs[3] as HTMLInputElement).value).toBe("secret-key");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
