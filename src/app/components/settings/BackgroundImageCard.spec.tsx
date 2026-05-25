// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { removeBackgroundImage, pickBackgroundImage } from "../../../shared/api/settings";
import type { AppSettings } from "../../../shared/types/app";
import { BackgroundImageCard } from "./BackgroundImageCard";

vi.mock("../../../shared/api/settings", () => ({
  pickBackgroundImage: vi.fn(),
  removeBackgroundImage: vi.fn(),
}));

vi.mock("../../hooks/useBackgroundImageObjectUrl", () => ({
  useBackgroundImageObjectUrl: (path: string) => (path ? `blob:${path}` : ""),
}));

const translations: Record<string, string> = {
  "common.loading": "Loading",
  "settings.backgroundTitle": "App Background",
  "settings.backgroundDefault": "Default Background",
  "settings.backgroundDefaultHint": "Follows theme",
  "settings.backgroundUpload": "Upload Background",
  "settings.backgroundClear": "Clear Background",
  "settings.backgroundPreviewAlt": "Background preview",
  "settings.backgroundGalleryHint": "The default background cannot be deleted.",
  "settings.backgroundEmpty": "No background image yet. Upload one to start.",
  "settings.backgroundCurrent": "Current background",
  "settings.backgroundDelete": "Delete background",
  "settings.backgroundRightClickDelete": "Right-click to delete immediately",
  "settings.backgroundBlurTitle": "Glass Blur",
  "settings.backgroundBlurHint": "Current blur strength: {value}px",
};

function createSettings(patch: Partial<NonNullable<AppSettings["uiPrefs"]>> = {}): AppSettings {
  return {
    activeProjectId: "project-1",
    modelProtocols: [],
    modelCatalog: [],
    agentBindings: [],
    uiPrefs: {
      backgroundImagePath: "",
      backgroundImagePaths: [],
      backgroundBlurPx: 18,
      ...patch,
    },
  };
}

function Harness(props: { initialSettings: AppSettings }) {
  const [settings, setSettings] = useState<AppSettings | null>(props.initialSettings);
  return (
    <>
      <BackgroundImageCard
        settings={settings as AppSettings}
        setSettings={setSettings}
        t={(key) => translations[String(key)] ?? String(key)}
      />
      <pre data-testid="settings-state">{JSON.stringify(settings)}</pre>
    </>
  );
}

function readSettings(container: HTMLDivElement): AppSettings {
  return JSON.parse(container.querySelector("[data-testid='settings-state']")?.textContent ?? "{}");
}

async function renderHarness(initialSettings: AppSettings) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Harness initialSettings={initialSettings} />);
  });
  return { container, root };
}

describe("BackgroundImageCard", () => {
  const removeBackgroundImageMock = vi.mocked(removeBackgroundImage);
  const pickBackgroundImageMock = vi.mocked(pickBackgroundImage);

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    removeBackgroundImageMock.mockResolvedValue({ ok: true, message: "removed" });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("always shows an undeletable default background that clears the active image", async () => {
    const view = await renderHarness(createSettings({
      backgroundImagePath: "C:/wallpapers/demo.png",
      backgroundImagePaths: ["C:/wallpapers/demo.png"],
    }));

    const defaultButton = Array.from(view.container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Default Background"),
    );
    expect(defaultButton).not.toBeUndefined();

    await act(async () => {
      defaultButton?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      defaultButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(removeBackgroundImageMock).not.toHaveBeenCalled();
    expect(readSettings(view.container).uiPrefs?.backgroundImagePath).toBe("");

    await act(async () => {
      view.root.unmount();
    });
    view.container.remove();
  });

  it("right-clicking an uploaded image deletes it immediately and returns to default", async () => {
    const view = await renderHarness(createSettings({
      backgroundImagePath: "C:/wallpapers/demo.png",
      backgroundImagePaths: ["C:/wallpapers/demo.png", "C:/wallpapers/other.png"],
    }));

    const imageButton = Array.from(view.container.querySelectorAll("button")).find(
      (button) => button.getAttribute("aria-label") === "Current background",
    );
    expect(imageButton).not.toBeUndefined();

    await act(async () => {
      imageButton?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(removeBackgroundImageMock).toHaveBeenCalledWith("C:/wallpapers/demo.png");
    expect(readSettings(view.container).uiPrefs).toMatchObject({
      backgroundImagePath: "",
      backgroundImagePaths: ["C:/wallpapers/other.png"],
    });
    expect(view.container.textContent).not.toContain("Delete background");

    await act(async () => {
      view.root.unmount();
    });
    view.container.remove();
  });

  it("uploading a background selects it without removing the default option", async () => {
    pickBackgroundImageMock.mockResolvedValue({ path: "C:/wallpapers/new.png" });
    const view = await renderHarness(createSettings());

    const uploadButton = Array.from(view.container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Upload Background"),
    );
    await act(async () => {
      uploadButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(readSettings(view.container).uiPrefs).toMatchObject({
      backgroundImagePath: "C:/wallpapers/new.png",
      backgroundImagePaths: ["C:/wallpapers/new.png"],
    });
    expect(view.container.textContent).toContain("Default Background");

    await act(async () => {
      view.root.unmount();
    });
    view.container.remove();
  });
});
