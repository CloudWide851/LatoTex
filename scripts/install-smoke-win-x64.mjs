import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nsisDir = path.join(repoRoot, "src-tauri", "target", "x86_64-pc-windows-msvc", "release", "bundle", "nsis");
const packageMetadataPath = path.join(repoRoot, "dist", "release", "windows-x64-package.json");
const startupWindowMs = Number(process.env.LATOTEX_INSTALL_SMOKE_STARTUP_MS ?? 90000);
const allowExisting = process.argv.includes("--allow-existing") || process.env.LATOTEX_INSTALL_SMOKE_ALLOW_EXISTING === "1";
if (process.argv.includes("--require-signing") || process.env.LATOTEX_REQUIRE_SIGNING === "1") {
  console.error("[install-smoke-win-x64] signing verification has been removed from install smoke.");
  process.exit(1);
}

function toRepoPath(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
}

function newestInstaller() {
  if (!fs.existsSync(nsisDir)) {
    return null;
  }
  return fs.readdirSync(nsisDir)
    .filter((name) => name.toLowerCase().endsWith(".exe"))
    .map((name) => path.join(nsisDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ?? null;
}

function run(command, args, label, options = {}) {
  console.log(`[install-smoke-win-x64] ${label}`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: false, ...options });
  if (result.status !== 0) {
    const status = result.status ?? 1;
    console.error(`[install-smoke-win-x64] failed: ${label} (exit ${status})`);
    process.exit(status);
  }
}

function verifyPackageMetadata(installer) {
  if (!fs.existsSync(packageMetadataPath)) {
    if (allowExisting) {
      return;
    }
    throw new Error("package metadata is missing; run pnpm release:build-installer:win-x64 first");
  }
  const metadata = JSON.parse(fs.readFileSync(packageMetadataPath, "utf8"));
  const installerStat = fs.statSync(installer);
  if (metadata.schema !== "latotex.windows-x64-package.v1" || !metadata.ok || metadata.status !== "passed") {
    throw new Error("package metadata does not describe a passed Windows x64 build");
  }
  if (metadata.installer?.path !== toRepoPath(installer)) {
    throw new Error(`newest installer does not match package metadata: ${toRepoPath(installer)} !== ${metadata.installer?.path}`);
  }
  if (metadata.installer?.size !== installerStat.size || installerStat.mtimeMs < Number(metadata.startedAtMs ?? 0)) {
    throw new Error("installer changed or predates the package metadata");
  }
}

function verifyHashFile(installer) {
  const hashPath = `${installer}.sha256`;
  if (!fs.existsSync(hashPath)) {
    throw new Error(`hash manifest missing: ${toRepoPath(hashPath)}`);
  }
  const hashStat = fs.statSync(hashPath);
  const installerStat = fs.statSync(installer);
  if (hashStat.mtimeMs < installerStat.mtimeMs) {
    throw new Error(`hash manifest is older than installer: ${toRepoPath(hashPath)}`);
  }
  const expected = fs.readFileSync(hashPath, "utf8").trim().split(/\s+/)[0];
  const actual = crypto.createHash("sha256").update(fs.readFileSync(installer)).digest("hex");
  if (expected !== actual) {
    throw new Error(`hash manifest does not match installer: ${toRepoPath(hashPath)}`);
  }
}

function verifyReport(reportPath) {
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  if (report.schema !== "latotex.tauri-smoke.v1" || report.mode !== "webview" || !report.ok) {
    console.error("[install-smoke-win-x64] installed app smoke failed:");
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  console.log(`[install-smoke-win-x64] installed app WebView smoke passed: ${reportPath}`);
}

if (process.platform !== "win32") {
  console.log("[install-smoke-win-x64] skipped: Windows install smoke must run on Windows.");
  process.exit(0);
}

const installer = newestInstaller();
if (!installer) {
  console.error("[install-smoke-win-x64] no Windows installer exe found.");
  process.exit(1);
}
try {
  verifyPackageMetadata(installer);
  verifyHashFile(installer);
} catch (error) {
  console.error(`[install-smoke-win-x64] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), "latotex-install-smoke-app-"));
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "latotex-install-smoke-runtime-"));
const reportPath = path.join(runtimeRoot, "tauri-smoke-report.json");
const progressPath = path.join(runtimeRoot, "tauri-smoke-progress.ndjson");
const installedExe = path.join(installRoot, "LatoTex.exe");
let passed = false;

try {
  run(installer, ["/S", `/D=${installRoot}`], `install ${path.relative(repoRoot, installer)}`);
  if (!fs.existsSync(installedExe)) {
    throw new Error(`installed exe not found: ${installedExe}`);
  }
  for (const requiredRelativePath of ["resources/core/share-page"]) {
    const requiredPath = path.join(installRoot, requiredRelativePath);
    if (!fs.existsSync(requiredPath)) {
      throw new Error(`installed resource missing: ${requiredPath}`);
    }
  }

  const child = spawn(installedExe, [
    "--latotex-smoke",
    `--latotex-runtime-root=${runtimeRoot}`,
    `--latotex-smoke-report=${reportPath}`,
    `--latotex-smoke-progress=${progressPath}`,
  ], {
    cwd: installRoot,
    stdio: "ignore",
    env: {
      ...process.env,
      LATOTEX_E2E_RUNTIME_ROOT: runtimeRoot,
      LATOTEX_SMOKE: "1",
      LATOTEX_SMOKE_REPORT_PATH: reportPath,
      LATOTEX_SMOKE_PROGRESS_PATH: progressPath,
    },
  });
  console.log(`[install-smoke-win-x64] launched installed exe pid=${child.pid}`);
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });

  const started = Date.now();
  while (Date.now() - started < startupWindowMs) {
    if (fs.existsSync(reportPath)) {
      verifyReport(reportPath);
      break;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  if (!fs.existsSync(reportPath)) {
    if (!exited) {
      child.kill();
    }
    throw new Error(`installed app did not write WebView smoke report within ${startupWindowMs}ms`);
  }
  if (!exited) {
    child.kill();
  }

  const uninstallExe = path.join(installRoot, "uninstall.exe");
  if (fs.existsSync(uninstallExe)) {
    run(uninstallExe, ["/S"], "uninstall smoke installation");
  }
  console.log("[install-smoke-win-x64] post-install smoke passed.");
  passed = true;
} catch (error) {
  console.error(`[install-smoke-win-x64] ${error instanceof Error ? error.message : String(error)}`);
  console.error(`[install-smoke-win-x64] kept failed runtime root: ${runtimeRoot}`);
  console.error(`[install-smoke-win-x64] progress log: ${progressPath}`);
  process.exit(1);
} finally {
  const uninstallExe = path.join(installRoot, "uninstall.exe");
  if (!passed && fs.existsSync(uninstallExe)) {
    spawnSync(uninstallExe, ["/S"], { stdio: "ignore", shell: false });
  }
  fs.rmSync(installRoot, { recursive: true, force: true });
  if (passed) {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
}
