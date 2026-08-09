// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  applyPersistedCspStyle,
  cspStyle,
  CSP_PERSISTED_STYLE_ATTRIBUTE,
  CSP_STYLE_ATTRIBUTE,
  installCspStyleRegistry,
  readPersistedCspStyle,
} from "./cspStyle";

describe("CSP-safe dynamic styles", () => {
  it("projects React styles to a stable data selector without a style attribute", () => {
    const first = cspStyle({ left: 12, width: "40%", backgroundColor: "#123456" });
    const second = cspStyle({ backgroundColor: "#123456", width: "40%", left: 12 });
    expect(first).toEqual(second);
    expect(first[CSP_STYLE_ATTRIBUTE]).toMatch(/^ltx-/);
    expect(first).not.toHaveProperty("style");
  });

  it("round-trips bounded persisted rich-text declarations", () => {
    const element = document.createElement("span");
    expect(applyPersistedCspStyle(element, [
      ["font-size", "18px"],
      ["color", "#1d4ed8"],
    ])).toBe(true);
    expect(element.hasAttribute("style")).toBe(false);
    expect(element.getAttribute(CSP_PERSISTED_STYLE_ATTRIBUTE)).toBeTruthy();
    expect(new Map(readPersistedCspStyle(element))).toEqual(new Map([
      ["color", "#1d4ed8"],
      ["font-size", "18px"],
    ]));
  });

  it("adds the production nonce to runtime style elements", () => {
    const meta = document.createElement("meta");
    meta.name = "latotex-style-nonce";
    meta.content = "runtime-random-nonce";
    document.head.appendChild(meta);
    installCspStyleRegistry();
    expect(document.createElement("style").getAttribute("nonce")).toBe(
      "runtime-random-nonce",
    );
  });
});
