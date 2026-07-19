if (typeof globalThis.CSS === "undefined") {
  Object.defineProperty(globalThis, "CSS", {
    configurable: true,
    value: {},
  });
}

if (typeof globalThis.CSS.escape !== "function") {
  Object.defineProperty(globalThis.CSS, "escape", {
    configurable: true,
    value: (value: string) => String(value).replace(
      /[^a-zA-Z0-9_-]/g,
      (character) => `\\${character.codePointAt(0)?.toString(16)} `,
    ),
  });
}
