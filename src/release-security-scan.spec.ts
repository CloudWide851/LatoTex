import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error release-security-scan.mjs is also the executable CI script.
import { scanRepository as scanRepositoryUntyped } from "../scripts/release-security-scan.mjs";

type SecurityFinding = { id: string; path: string; line: number };

const scanRepository = scanRepositoryUntyped as (repoRoot: string) => SecurityFinding[];

const tempRoots: string[] = [];

function writeFile(root: string, relativePath: string, content: string) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function createFixture(options: { signed?: boolean } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "latotex-security-scan-"));
  tempRoots.push(root);
  const scripts = {
    "tauri:build:win-x64": "pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis",
    "release:package:win-x64": "node scripts/release-check-win-x64.mjs --mode=package",
    "release:install-smoke:win-x64": "node scripts/install-smoke-win-x64.mjs",
    ...(options.signed
      ? { "release:package:win-x64:signed": "pnpm release:package:win-x64 --require-signing" }
      : {}),
  };

  writeFile(root, "package.json", JSON.stringify({ scripts }, null, 2));
  writeFile(root, "src-tauri/tauri.conf.json", JSON.stringify({
    app: { security: { csp: "default-src 'self'" } },
    bundle: { targets: "nsis" },
  }));
  writeFile(root, "src-tauri/capabilities/default.json", JSON.stringify({ windows: ["main"] }));
  writeFile(
    root,
    ".github/workflows/release-tauri.yml",
    options.signed
      ? "jobs:\n  build:\n    runs-on: windows-latest\n    steps:\n      - run: pnpm release:package:win-x64:signed\n"
      : "jobs:\n  build:\n    runs-on: windows-latest\n    steps:\n      - run: pnpm release:package:win-x64\n",
  );
  return root;
}

describe("release-security-scan", () => {
  afterEach(() => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root) {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("accepts the unsigned Windows x64 release policy", () => {
    expect(scanRepository(createFixture())).toEqual([]);
  });

  it("fails when Windows signing gates are reintroduced", () => {
    const findingIds = scanRepository(createFixture({ signed: true })).map((finding) => finding.id);
    expect(findingIds).toContain("release-signing-flow-reintroduced");
    expect(findingIds).toContain("release-workflow-signing-reintroduced");
  });
});
