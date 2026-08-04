import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error bundled-resource-contract.mjs is shared with release scripts.
import { REQUIRED_BUNDLED_RESOURCE_DIRECTORIES, REQUIRED_BUNDLED_RESOURCE_FILES, verifyBundledResourceContract } from "../scripts/bundled-resource-contract.mjs";
// @ts-expect-error prepare-drawio-assets.mjs is also the executable release bootstrap.
import { DRAWIO_REQUIRED_VENDOR_FILES, verifyDrawioVendor } from "../scripts/prepare-drawio-assets.mjs";
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
  "      - run: pnpm release:prepare-tools:win-x64",
  "      - run: pnpm release:prepare-drawio",
  "      - run: pnpm release:validate:win-x64",
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
    "release:prepare-tools:win-x64": "pwsh -NoProfile -File scripts/prepare-bundled-tools-win-x64.ps1",
    "release:prepare-drawio": "node scripts/prepare-drawio-assets.mjs",
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

function createBundledResourceFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "latotex-bundled-resources-"));
  tempRoots.push(root);
  for (const relativePath of REQUIRED_BUNDLED_RESOURCE_FILES) {
    writeFile(root, relativePath, "fixture");
  }
  for (const relativePath of REQUIRED_BUNDLED_RESOURCE_DIRECTORIES) {
    fs.mkdirSync(path.join(root, relativePath), { recursive: true });
  }

  const cloudflaredContent = "cloudflared-fixture";
  writeFile(root, "tools/cloudflared-windows-amd64.exe", cloudflaredContent);
  writeFile(root, "tools/cloudflared-version.json", JSON.stringify({
    version: "fixture",
    file: "cloudflared-windows-amd64.exe",
    size: Buffer.byteLength(cloudflaredContent),
    sha256: crypto.createHash("sha256").update(cloudflaredContent).digest("hex"),
  }));
  writeFile(root, "tools/uv/uv-version.json", JSON.stringify({
    relativePath: "uv/windows-x64/uv.exe",
    version: "uv fixture",
  }));
  writeFile(root, "core/drawio/drawio-version.json", JSON.stringify({
    source: { tag: "v29.6.6" },
    asset: { size: 52104150, sha256: "A".repeat(64) },
    vendor: { expectedFileCount: 3337 },
  }));
  return root;
}

function createDrawioFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "latotex-drawio-assets-"));
  tempRoots.push(root);
  writeFile(root, "index.html", "drawio host");
  writeFile(root, "drawio-version.json", JSON.stringify({
    source: { tag: "v29.6.6" },
    asset: {
      downloadUrl: "https://github.com/jgraph/drawio/releases/download/v29.6.6/draw.war",
      size: 52104150,
      sha256: "E538FD1320C5E3B95D5709A880716EF1409FFFCBB0A274773A89E374153CF17A",
    },
    vendor: {
      expectedFileCount: DRAWIO_REQUIRED_VENDOR_FILES.length,
      excludedPaths: ["WEB-INF/classes"],
    },
  }));
  for (const relativePath of DRAWIO_REQUIRED_VENDOR_FILES) {
    writeFile(root, path.join("vendor", relativePath), "fixture");
  }
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

  it("rejects a multi-platform release build", () => {
    const findingIds = scanRepository(createFixture({ workflow: unsignedMultiPlatformWorkflow })).map((finding) => finding.id);
    expect(findingIds).toContain("release-workflow-non-windows-build");
  });

  it("fails when bundled tools are not prepared before validation", () => {
    const workflow = unsignedWindowsWorkflow.replace("pnpm release:prepare-tools:win-x64", "pnpm build");
    const findingIds = scanRepository(createFixture({ workflow })).map((finding) => finding.id);
    expect(findingIds).toContain("release-workflow-missing-bundled-tools-prepare");
  });

  it("fails when DrawIO is not prepared before validation", () => {
    const workflow = unsignedWindowsWorkflow.replace("pnpm release:prepare-drawio", "pnpm build");
    const findingIds = scanRepository(createFixture({ workflow })).map((finding) => finding.id);
    expect(findingIds).toContain("release-workflow-missing-drawio-prepare");
  });

  it("pins the ignored Windows runtime bootstrap and offline seed", () => {
    const script = fs.readFileSync(
      path.resolve(process.cwd(), "scripts/prepare-bundled-tools-win-x64.ps1"),
      "utf8",
    );
    const seed = fs.readFileSync(
      path.resolve(process.cwd(), "scripts/assets/tectonic-offline-seed-2022.0r0.zip"),
    );

    expect(script).toContain("cloudflared/releases/download/2026.2.0/cloudflared-windows-amd64.exe");
    expect(script).toContain("astral-sh/uv/releases/download/0.11.10/uv-x86_64-pc-windows-msvc.zip");
    expect(script).toContain("tectonic%400.15.0/tectonic-0.15.0-x86_64-pc-windows-msvc.zip");
    expect(script).toContain("-RangeEnd ($tectonicBundleBytes - 1)");
    expect(script).not.toContain("/releases/latest/");
    expect(crypto.createHash("sha256").update(seed).digest("hex").toUpperCase()).toBe(
      "8313FDD44E93D85B13653579A66C67D62893ACC20EE9F3FEB87B9393542D1281",
    );
    expect(seed.byteLength).toBeLessThan(100 * 1024 * 1024);
  });

  it("restores DrawIO from the digest-pinned official release asset", () => {
    const script = fs.readFileSync(
      path.resolve(process.cwd(), "scripts/prepare-drawio-assets.mjs"),
      "utf8",
    );
    const manifest = JSON.parse(
      fs.readFileSync(
        path.resolve(process.cwd(), "src-tauri/resources/core/drawio/drawio-version.json"),
        "utf8",
      ),
    ) as {
      asset: { downloadUrl: string; size: number; sha256: string };
      vendor: { expectedFileCount: number; excludedPaths: string[] };
    };

    expect(manifest.asset).toEqual({
      downloadUrl: "https://github.com/jgraph/drawio/releases/download/v29.6.6/draw.war",
      size: 52104150,
      sha256: "E538FD1320C5E3B95D5709A880716EF1409FFFCBB0A274773A89E374153CF17A",
    });
    expect(manifest.vendor).toMatchObject({
      expectedFileCount: 3337,
      excludedPaths: ["WEB-INF/classes"],
    });
    expect(script).toContain('redirect: "manual"');
    expect(script).toContain('spawnSync("tar"');
    expect(script).not.toContain("/releases/latest/");
  });

  it("validates the DrawIO vendor and rejects bundled server classes", () => {
    const root = createDrawioFixture();
    expect(verifyDrawioVendor(root)).toMatchObject({
      fileCount: DRAWIO_REQUIRED_VENDOR_FILES.length,
      tag: "v29.6.6",
    });

    writeFile(root, "vendor/WEB-INF/classes/Unsafe.class", "fixture");
    expect(() => verifyDrawioVendor(root)).toThrow("DrawIO vendor contains excluded server classes");
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

  it("keeps the installed-app smoke poll non-blocking and diagnostic", () => {
    const script = fs.readFileSync(
      path.resolve(process.cwd(), "scripts/install-smoke-win-x64.mjs"),
      "utf8",
    );

    expect(script).not.toContain("Atomics.wait");
    expect(script).toContain("await wait(500)");
    expect(script).toContain("install-smoke-process.log");
    expect(script).toContain("installed app exited before smoke report");
  });

  it("keeps core research and native tool resources inside the NSIS bundle contract", () => {
    const tauriConfig = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
    ) as { bundle?: { resources?: string[] } };
    const installSmoke = fs.readFileSync(
      path.resolve(process.cwd(), "scripts/install-smoke-win-x64.mjs"),
      "utf8",
    );

    expect(tauriConfig.bundle?.resources).toEqual(expect.arrayContaining([
      "resources/core",
      "resources/tools",
      "resources/python/analysis_runtime",
    ]));
    expect(installSmoke).toContain("verifyBundledResourceContract");
    expect(installSmoke).toContain("bundled uv verified");
  });

  it("validates the reusable bundled resource contract and reports missing assets", () => {
    const resourcesRoot = createBundledResourceFixture();
    expect(() => verifyBundledResourceContract(resourcesRoot)).not.toThrow();

    fs.rmSync(path.join(resourcesRoot, "core/skills/catalog.json"));
    expect(() => verifyBundledResourceContract(resourcesRoot)).toThrow(
      "bundled resources incomplete: core/skills/catalog.json",
    );
  });
});
