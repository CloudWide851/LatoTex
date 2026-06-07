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

const unsignedWindowsWorkflow = [
  "jobs:",
  "  build:",
  "    runs-on: windows-latest",
  "    steps:",
  "      - run: pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis",
  "      - run: pnpm release:package:win-x64",
  "",
].join("\n");

const unsignedMultiPlatformWorkflow = [
  "jobs:",
  "  build-release-artifacts:",
  "    strategy:",
  "      matrix:",
  "        include:",
  "          - name: windows-x64",
  "            runner: windows-latest",
  "            os: windows",
  "            target: x86_64-pc-windows-msvc",
  "            bundles: nsis",
  "          - name: linux-x64",
  "            runner: ubuntu-22.04",
  "            os: linux",
  "            target: \"\"",
  "            bundles: deb,appimage",
  "          - name: macos-x64",
  "            runner: macos-15-intel",
  "            os: macos",
  "            target: x86_64-apple-darwin",
  "            bundles: dmg",
  "    runs-on: ${{ matrix.runner }}",
  "    steps:",
  "      - run: pnpm release:package:win-x64",
  "        if: matrix.os == 'windows'",
  "  publish-release:",
  "    runs-on: ubuntu-latest",
  "",
].join("\n");

function createFixture(options: { signed?: boolean; workflow?: string } = {}) {
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
    options.workflow ??
      (options.signed
        ? unsignedWindowsWorkflow.replace("release:package:win-x64", "release:package:win-x64:signed")
        : unsignedWindowsWorkflow),
  );
  return root;
}

function openAiKeyShapedTestValue() {
  return ["sk", "a".repeat(48)].join("-");
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

  it("accepts the unsigned multi-platform release policy", () => {
    expect(scanRepository(createFixture({ workflow: unsignedMultiPlatformWorkflow }))).toEqual([]);
  });

  it("fails when the release workflow loses the Windows unsigned package gate", () => {
    const workflow = unsignedMultiPlatformWorkflow.replace("pnpm release:package:win-x64", "pnpm build");
    const findingIds = scanRepository(createFixture({ workflow })).map((finding) => finding.id);
    expect(findingIds).toContain("release-workflow-missing-unsigned-package-gate");
  });

  it("fails when Windows signing gates are reintroduced", () => {
    const findingIds = scanRepository(createFixture({ signed: true })).map((finding) => finding.id);
    expect(findingIds).toContain("release-signing-flow-reintroduced");
    expect(findingIds).toContain("release-workflow-signing-reintroduced");
  });

  it("fails when an mjs test fixture contains an OpenAI-shaped key", () => {
    const root = createFixture();
    writeFile(root, "scripts/leaked-fixture.mjs", `export const key = "${openAiKeyShapedTestValue()}";`);

    expect(scanRepository(root)).toContainEqual({
      id: "openai-api-key",
      path: "scripts/leaked-fixture.mjs",
      line: 1,
    });
  });

  it("fails when a Rust test fixture contains an OpenAI-shaped key", () => {
    const root = createFixture();
    writeFile(root, "src-tauri/src/secure.rs", `const API_KEY: &str = "${openAiKeyShapedTestValue()}";`);

    expect(scanRepository(root)).toContainEqual({
      id: "openai-api-key",
      path: "src-tauri/src/secure.rs",
      line: 1,
    });
  });
});
