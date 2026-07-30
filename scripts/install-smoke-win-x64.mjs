import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyBundledResourceContract } from "./bundled-resource-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nsisDir = path.join(repoRoot, "src-tauri", "target", "x86_64-pc-windows-msvc", "release", "bundle", "nsis");
const startupWindowMs = Number(process.env.LATOTEX_INSTALL_SMOKE_STARTUP_MS ?? 90000);

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

function verifyReport(reportPath) {
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  if (report.schema !== "latotex.tauri-smoke.v1" || report.mode !== "webview" || !report.ok) {
    throw new Error(`installed app smoke failed: ${JSON.stringify(report)}`);
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

const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), "latotex-install-smoke-app-"));
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "latotex-install-smoke-runtime-"));
const reportPath = path.join(runtimeRoot, "tauri-smoke-report.json");
const processLogPath = path.join(runtimeRoot, "install-smoke-process.log");
const installedExe = path.join(installRoot, "LatoTex.exe");
let passed = false;
let child = null;
let processLog = null;

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

try {
  run(installer, ["/S", `/D=${installRoot}`], `install ${path.relative(repoRoot, installer)}`);
  if (!fs.existsSync(installedExe)) {
    throw new Error(`installed exe not found: ${installedExe}`);
  }
  const resourceVerification = verifyBundledResourceContract(path.join(installRoot, "resources"), {
    label: "installed bundled resources",
    verifyExecutables: true,
  });
  console.log(`[install-smoke-win-x64] bundled uv verified: ${resourceVerification.versions.uv}`);

  processLog = fs.openSync(processLogPath, "a");
  child = spawn(installedExe, [
    "--latotex-smoke",
    `--latotex-runtime-root=${runtimeRoot}`,
    `--latotex-smoke-report=${reportPath}`,
  ], {
    cwd: installRoot,
    stdio: ["ignore", processLog, processLog],
    env: {
      ...process.env,
      LATOTEX_E2E_RUNTIME_ROOT: runtimeRoot,
      LATOTEX_SMOKE: "1",
      LATOTEX_SMOKE_REPORT_PATH: reportPath,
    },
  });
  console.log(`[install-smoke-win-x64] launched installed exe pid=${child.pid}`);
  let exitResult = null;
  child.once("error", (error) => {
    exitResult = { error };
  });
  child.once("exit", (code, signal) => {
    exitResult = { code, signal };
  });

  const started = Date.now();
  while (Date.now() - started < startupWindowMs) {
    if (fs.existsSync(reportPath)) {
      verifyReport(reportPath);
      break;
    }
    if (exitResult) {
      const detail = exitResult.error
        ? `spawn error=${exitResult.error.message}`
        : `code=${String(exitResult.code)} signal=${String(exitResult.signal)}`;
      throw new Error(`installed app exited before smoke report (${detail}); process log: ${processLogPath}`);
    }
    await wait(500);
  }
  if (!fs.existsSync(reportPath)) {
    if (!exitResult) {
      child.kill();
    }
    throw new Error(
      `installed app did not write WebView smoke report within ${startupWindowMs}ms; process log: ${processLogPath}`,
    );
  }
  if (!exitResult) {
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
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill();
  }
  if (processLog !== null) {
    fs.closeSync(processLog);
  }
  const uninstallExe = path.join(installRoot, "uninstall.exe");
  if (!passed && fs.existsSync(uninstallExe)) {
    spawnSync(uninstallExe, ["/S"], { stdio: "ignore", shell: false });
  }
  fs.rmSync(installRoot, { recursive: true, force: true });
  if (passed) {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
}
