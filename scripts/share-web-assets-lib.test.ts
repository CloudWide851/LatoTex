import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  listInvalidBrowserImportSpecifiers,
  rewriteShareVendorImports,
  shouldSkipBrowserVendorPath,
} from "./share-web-assets-lib.mjs";

describe("share-web-assets-lib", () => {
  it("rewrites yjs root imports into browser-relative paths", () => {
    const source = `import * as random from "lib0/random"\nimport { callAll } from "lib0/function.js"\n`;
    const rewritten = rewriteShareVendorImports(source, "yjs.mjs");
    expect(rewritten).toContain(`from "./lib0/random.js"`);
    expect(rewritten).toContain(`from "./lib0/function.js"`);
  });

  it("rewrites nested lib0 imports relative to the current file", () => {
    const source = `import { getRandomValues } from "lib0/webcrypto"\n`;
    const rewritten = rewriteShareVendorImports(source, "lib0/crypto/common.js");
    expect(rewritten).toContain(`from "../webcrypto.js"`);
  });

  it("reports unsupported bare specifiers after rewrite", () => {
    const valid = rewriteShareVendorImports(`import * as random from "lib0/random"\n`, "yjs.mjs");
    expect(listInvalidBrowserImportSpecifiers(valid)).toEqual([]);

    const invalid = `import { webcrypto } from "node:crypto"\n`;
    expect(listInvalidBrowserImportSpecifiers(invalid)).toEqual(["node:crypto"]);
  });

  it("keeps rewritten specifiers portable with posix-style paths", () => {
    const rewritten = rewriteShareVendorImports(`import { x } from "lib0/map"\n`, path.posix.join("lib0", "delta", "binding.js"));
    expect(rewritten).toContain(`from "../map.js"`);
  });

  it("skips browser-incompatible vendor entries that are not runtime imports", () => {
    expect(shouldSkipBrowserVendorPath("lib0/bin/0serve.js")).toBe(true);
    expect(shouldSkipBrowserVendorPath("lib0/isomorphic.js")).toBe(true);
    expect(shouldSkipBrowserVendorPath("pdf.min.mjs")).toBe(true);
    expect(shouldSkipBrowserVendorPath("lib0/random.js")).toBe(false);
  });
});
