import type { CSSProperties } from "react";

const STYLE_ATTRIBUTE = "data-latotex-style";
const PERSISTED_STYLE_ATTRIBUTE = "data-latotex-rich-style";
const STYLE_LINK_SELECTOR = "link[data-latotex-dynamic-styles]";
const STYLE_NONCE_SELECTOR = 'meta[name="latotex-style-nonce"]';
const TAURI_STYLE_NONCE_TOKEN = "__TAURI_STYLE_NONCE__";
const MAX_REGISTERED_STYLES = 1_024;

type CspStyleValue = string | number | null | undefined;
export type CspStyleProperties = CSSProperties
  | (CSSProperties & Partial<Record<`--${string}`, CspStyleValue>>);

const UNIT_LESS_PROPERTIES = new Set([
  "animationIterationCount",
  "columnCount",
  "flex",
  "flexGrow",
  "flexShrink",
  "fontWeight",
  "gridArea",
  "gridColumn",
  "gridColumnEnd",
  "gridColumnStart",
  "gridRow",
  "gridRowEnd",
  "gridRowStart",
  "lineHeight",
  "opacity",
  "order",
  "scale",
  "tabSize",
  "zIndex",
  "zoom",
]);

const payloadByToken = new Map<string, ReadonlyArray<readonly [string, string]>>();
const registeredTokens = new Set<string>();
let dynamicSheet: CSSStyleSheet | null = null;
let linkLoadListenerInstalled = false;
let styleElementNonceInstalled = false;

function cssPropertyName(property: string): string | null {
  if (property.startsWith("--")) {
    return /^--[a-zA-Z0-9_-]+$/.test(property) ? property : null;
  }
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(property)) {
    return null;
  }
  return property
    .replace(/^ms/, "-ms")
    .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function cssPropertyValue(property: string, value: string | number): string {
  if (typeof value === "number" && value !== 0 && !UNIT_LESS_PROPERTIES.has(property)) {
    return `${value}px`;
  }
  return String(value);
}

function normalizedEntries(style: CspStyleProperties): ReadonlyArray<readonly [string, string]> {
  return Object.entries(style)
    .filter((entry): entry is [string, string | number] => entry[1] != null)
    .map(([property, value]) => {
      const cssName = cssPropertyName(property);
      if (!cssName) {
        throw new Error(`Unsupported CSP style property: ${property}`);
      }
      return [cssName, cssPropertyValue(property, value)] as const;
    })
    .sort(([left], [right]) => left.localeCompare(right));
}

function validatedEntries(value: unknown): ReadonlyArray<readonly [string, string]> | null {
  if (!Array.isArray(value) || value.length > 24) {
    return null;
  }
  const entries: Array<readonly [string, string]> = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      return null;
    }
    const [property, rawValue] = entry;
    if (typeof property !== "string"
      || typeof rawValue !== "string"
      || rawValue.length > 512
      || !/^(?:--[a-zA-Z0-9_-]+|[a-zA-Z][a-zA-Z0-9-]*)$/.test(property)
      || /[\u0000-\u001f\u007f]/.test(rawValue)) {
      return null;
    }
    entries.push([property, rawValue]);
  }
  return entries.sort(([left], [right]) => left.localeCompare(right));
}

function hashPayload(payload: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < payload.length; index += 1) {
    const code = payload.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `ltx-${first.toString(36)}-${second.toString(36)}`;
}

function resolveDynamicSheet(): CSSStyleSheet | null {
  if (dynamicSheet) {
    return dynamicSheet;
  }
  if (typeof document === "undefined") {
    return null;
  }
  const link = document.querySelector<HTMLLinkElement>(STYLE_LINK_SELECTOR);
  const sheet = link?.sheet;
  if (sheet instanceof CSSStyleSheet) {
    dynamicSheet = sheet;
    return sheet;
  }
  if (link && !linkLoadListenerInstalled) {
    linkLoadListenerInstalled = true;
    link.addEventListener("load", () => {
      dynamicSheet = link.sheet instanceof CSSStyleSheet ? link.sheet : null;
      if (dynamicSheet) {
        for (const token of payloadByToken.keys()) {
          registerRule(token);
        }
      }
    }, { once: true });
  }
  return null;
}

function registerRule(token: string) {
  if (registeredTokens.has(token)) {
    return;
  }
  const sheet = resolveDynamicSheet();
  const entries = payloadByToken.get(token);
  if (!sheet || !entries) {
    return;
  }
  const index = sheet.insertRule(`[${STYLE_ATTRIBUTE}="${token}"] {}`, sheet.cssRules.length);
  const rule = sheet.cssRules.item(index);
  if (!(rule instanceof CSSStyleRule)) {
    sheet.deleteRule(index);
    throw new Error("Unable to register a CSP-safe dynamic style rule");
  }
  for (const [property, value] of entries) {
    rule.style.setProperty(property, value);
  }
  registeredTokens.add(token);
}

function rebuildActiveRules(currentToken: string) {
  const sheet = resolveDynamicSheet();
  if (!sheet || typeof document === "undefined") {
    return;
  }
  const activeTokens = new Set(
    Array.from(document.querySelectorAll<HTMLElement>(`[${STYLE_ATTRIBUTE}]`))
      .map((element) => element.getAttribute(STYLE_ATTRIBUTE))
      .filter((token): token is string => Boolean(token)),
  );
  activeTokens.add(currentToken);
  for (let index = sheet.cssRules.length - 1; index >= 0; index -= 1) {
    sheet.deleteRule(index);
  }
  for (const token of Array.from(payloadByToken.keys())) {
    if (!activeTokens.has(token)) {
      payloadByToken.delete(token);
    }
  }
  registeredTokens.clear();
  for (const token of activeTokens) {
    registerRule(token);
  }
}

function tokenForEntries(entries: ReadonlyArray<readonly [string, string]>): string {
  const payload = JSON.stringify(entries);
  let token = hashPayload(payload);
  let suffix = 0;
  while (payloadByToken.has(token)
    && JSON.stringify(payloadByToken.get(token)) !== payload) {
    suffix += 1;
    token = `${hashPayload(payload)}-${suffix}`;
  }
  payloadByToken.set(token, entries);
  registerRule(token);
  if (payloadByToken.size > MAX_REGISTERED_STYLES) {
    rebuildActiveRules(token);
  }
  return token;
}

export function installCspStyleRegistry() {
  if (typeof document !== "undefined" && !styleElementNonceInstalled) {
    styleElementNonceInstalled = true;
    const originalCreateElement = document.createElement;
    document.createElement = function createElementWithStyleNonce(
      this: Document,
      tagName: string,
      options?: ElementCreationOptions,
    ): HTMLElement {
      const element = originalCreateElement.call(this, tagName, options);
      if (tagName.toLowerCase() === "style") {
        const nonce = document.querySelector<HTMLMetaElement>(STYLE_NONCE_SELECTOR)?.content.trim();
        if (nonce && nonce !== TAURI_STYLE_NONCE_TOKEN) {
          element.setAttribute("nonce", nonce);
        }
      }
      return element;
    } as typeof document.createElement;
  }
  resolveDynamicSheet();
}

export function cspStyle(style: CspStyleProperties | null | undefined): Record<string, string> {
  if (!style) {
    return {};
  }
  const entries = normalizedEntries(style);
  if (entries.length === 0) {
    return {};
  }
  const token = tokenForEntries(entries);
  return { [STYLE_ATTRIBUTE]: token };
}

export function applyPersistedCspStyle(
  element: HTMLElement,
  value: ReadonlyArray<readonly [string, string]>,
): boolean {
  const entries = validatedEntries(value);
  if (!entries || entries.length === 0) {
    element.removeAttribute(STYLE_ATTRIBUTE);
    element.removeAttribute(PERSISTED_STYLE_ATTRIBUTE);
    return false;
  }
  const token = tokenForEntries(entries);
  element.setAttribute(STYLE_ATTRIBUTE, token);
  element.setAttribute(PERSISTED_STYLE_ATTRIBUTE, JSON.stringify(entries));
  return true;
}

export function readPersistedCspStyle(
  element: HTMLElement,
): ReadonlyArray<readonly [string, string]> {
  const raw = element.getAttribute(PERSISTED_STYLE_ATTRIBUTE);
  if (!raw || raw.length > 8_192) {
    return [];
  }
  try {
    return validatedEntries(JSON.parse(raw)) ?? [];
  } catch {
    return [];
  }
}

export function restorePersistedCspStyle(element: HTMLElement): boolean {
  return applyPersistedCspStyle(element, readPersistedCspStyle(element));
}

export const CSP_STYLE_ATTRIBUTE = STYLE_ATTRIBUTE;
export const CSP_PERSISTED_STYLE_ATTRIBUTE = PERSISTED_STYLE_ATTRIBUTE;
