#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(repoRoot, "src-tauri", "target", "x86_64-pc-windows-msvc", "release");
const reportRoot = path.join(repoRoot, ".latotex", "reports", "soak");
const startupWindowMs = Number(process.env.LATOTEX_GUI_SOAK_STARTUP_MS ?? 120000);

function newestReleaseExe() {
  const preferred = [
    path.join(releaseDir, "latotex.exe"),
    path.join(releaseDir, "LatoTex.exe"),
  ].filter((candidate) => fs.existsSync(candidate));
  if (preferred.length > 0) {
    return preferred[0];
  }
  if (!fs.existsSync(releaseDir)) {
    return null;
  }
  return fs.readdirSync(releaseDir)
    .filter((name) => name.toLowerCase().endsWith(".exe"))
    .filter((name) => !name.toLowerCase().includes("setup"))
    .filter((name) => !name.toLowerCase().includes("uninstall"))
    .map((name) => path.join(releaseDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ?? null;
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function verifySmokeReport(reportPath) {
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  if (report.schema !== "latotex.tauri-smoke.v1" || report.mode !== "webview" || !report.ok) {
    throw new Error(`invalid WebView smoke report: ${JSON.stringify(report, null, 2)}`);
  }
  const required = ["gui.viewport", "gui.project.0.search", "gui.project.1.search", "gui.project.2.search"];
  const stepNames = new Set((report.steps ?? []).map((step) => step.name));
  const missing = required.filter((name) => !stepNames.has(name));
  if (missing.length > 0) {
    throw new Error(`GUI matrix report missing steps: ${missing.join(", ")}`);
  }
  return report;
}

async function runScenario(exePath, scenarioName) {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), `latotex-gui-soak-${scenarioName}-`));
  const reportPath = path.join(runtimeRoot, "tauri-smoke-report.json");
  const progressPath = path.join(runtimeRoot, "tauri-smoke-progress.ndjson");
  const processLogPath = path.join(runtimeRoot, "tauri-smoke-process.log");
  const processLog = fs.openSync(processLogPath, "a");
  const child = spawn(exePath, [
    "--latotex-smoke",
    "--latotex-smoke-scenario=gui-matrix",
    `--latotex-runtime-root=${runtimeRoot}`,
    `--latotex-smoke-report=${reportPath}`,
    `--latotex-smoke-progress=${progressPath}`,
  ], {
    cwd: path.dirname(exePath),
    detached: false,
    stdio: ["ignore", processLog, processLog],
    env: {
      ...process.env,
      LATOTEX_E2E_RUNTIME_ROOT: runtimeRoot,
      LATOTEX_SMOKE: "1",
      LATOTEX_SMOKE_SCENARIO: "gui-matrix",
      LATOTEX_SMOKE_REPORT_PATH: reportPath,
      LATOTEX_SMOKE_PROGRESS_PATH: progressPath,
    },
  });
  const started = Date.now();
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  while (Date.now() - started < startupWindowMs) {
    if (fs.existsSync(reportPath)) {
      const report = verifySmokeReport(reportPath);
      if (!exited) {
        child.kill();
      }
      fs.closeSync(processLog);
      return {
        name: scenarioName,
        ok: true,
        durationMs: Date.now() - started,
        runtimeRoot,
        reportPath,
        progressPath,
        processLogPath,
        steps: report.steps?.length ?? 0,
      };
    }
    sleep(500);
  }
  if (!exited) {
    child.kill();
  }
  fs.closeSync(processLog);
  throw new Error(`GUI soak scenario ${scenarioName} did not write a WebView report within ${startupWindowMs}ms; runtime=${runtimeRoot}; progress=${progressPath}; log=${processLogPath}`);
}

async function main() {
  if (process.platform !== "win32") {
    console.log("[gui-soak-win-x64] skipped: Windows GUI soak must run on Windows.");
    return;
  }
  const exePath = newestReleaseExe();
  if (!exePath) {
    throw new Error(`release executable not found under ${path.relative(repoRoot, releaseDir)}`);
  }
  fs.mkdirSync(reportRoot, { recursive: true });
  const started = Date.now();
  const scenarios = ["desktop", "compact"];
  const results = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(exePath, scenario));
  }
  const report = {
    schema: "latotex.gui-soak.v1",
    ok: true,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    executable: path.relative(repoRoot, exePath).replaceAll(path.sep, "/"),
    scenarios: results,
  };
  const reportPath = path.join(reportRoot, `gui-soak-${nowStamp()}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[gui-soak-win-x64] GUI matrix passed: ${reportPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
