import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(repoRoot, "src-tauri", "target", "x86_64-pc-windows-msvc", "release");
const exePath = path.join(releaseDir, "latotex.exe");
const startupWindowMs = Number(process.env.LATOTEX_SMOKE_STARTUP_MS ?? 60000);
const allowNativeFallback = process.argv.includes("--allow-native-fallback")
  || process.env.LATOTEX_SMOKE_ALLOW_NATIVE_FALLBACK === "1";

if (process.platform !== "win32") {
  console.log("[tauri-smoke-win-x64] skipped: Windows x64 smoke must run on Windows.");
  process.exit(0);
}

if (!fs.existsSync(exePath)) {
  console.error(`[tauri-smoke-win-x64] executable not found: ${path.relative(repoRoot, exePath)}`);
  process.exit(1);
}

const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "latotex-smoke-"));
const reportPath = path.join(runtimeRoot, "tauri-smoke-report.json");
const progressPath = path.join(runtimeRoot, "tauri-smoke-progress.ndjson");
const processLogPath = path.join(runtimeRoot, "tauri-smoke-process.log");
const processLog = fs.openSync(processLogPath, "a");
const smokeArgs = [
  "--latotex-smoke",
  `--latotex-runtime-root=${runtimeRoot}`,
  `--latotex-smoke-report=${reportPath}`,
  `--latotex-smoke-progress=${progressPath}`,
];
console.log(`[tauri-smoke-win-x64] runtime root: ${runtimeRoot}`);
const child = spawn(exePath, smokeArgs, {
  cwd: path.dirname(exePath),
  detached: false,
  stdio: ["ignore", processLog, processLog],
  env: {
    ...process.env,
    LATOTEX_E2E_RUNTIME_ROOT: runtimeRoot,
    LATOTEX_SMOKE: "1",
    LATOTEX_SMOKE_REPORT_PATH: reportPath,
    LATOTEX_SMOKE_PROGRESS_PATH: progressPath,
  },
});
console.log(`[tauri-smoke-win-x64] launched pid=${child.pid}`);

let exited = false;
let exitCode = null;
let exitSignal = null;
let completed = false;

function finish(status) {
  if (completed) {
    return;
  }
  completed = true;
  clearInterval(pollTimer);
  clearTimeout(timeoutTimer);
  if (!exited) {
    child.kill();
  }
  process.exit(status);
}

function readReportIfReady() {
  if (!fs.existsSync(reportPath)) {
    return false;
  }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  if (report.schema !== "latotex.tauri-smoke.v1") {
    console.error(`[tauri-smoke-win-x64] unsupported smoke report schema: ${String(report.schema)}`);
    finish(1);
    return true;
  }
  if (report.mode !== "webview" && !allowNativeFallback) {
    console.error(`[tauri-smoke-win-x64] smoke report was not produced by WebView: mode=${String(report.mode)}`);
    finish(1);
    return true;
  }
  if (!report.ok) {
    console.error(`[tauri-smoke-win-x64] smoke failed: ${report.error ?? report.status}`);
    console.error(JSON.stringify(report.steps ?? [], null, 2));
    finish(1);
    return true;
  }
  console.log(`[tauri-smoke-win-x64] smoke passed: ${path.relative(repoRoot, reportPath)}`);
  for (const step of report.steps ?? []) {
    console.log(`- ${step.name}: ${step.ok ? "ok" : "failed"}${step.detail ? ` (${step.detail})` : ""}`);
  }
  finish(0);
  return true;
}

function printDiagnostics() {
  console.error(`[tauri-smoke-win-x64] runtime root: ${runtimeRoot}`);
  console.error(`[tauri-smoke-win-x64] process log: ${processLogPath}`);
  console.error(`[tauri-smoke-win-x64] progress log: ${progressPath}`);
  const bootPath = path.join(runtimeRoot, "tauri-smoke-boot.json");
  for (const diagnosticPath of [bootPath, progressPath]) {
    if (!fs.existsSync(diagnosticPath)) {
      continue;
    }
    const content = fs.readFileSync(diagnosticPath, "utf8").trim();
    if (content) {
      console.error(`[tauri-smoke-win-x64] ${path.basename(diagnosticPath)}:\n${content.slice(-6000)}`);
    }
  }
}

child.once("exit", (code, signal) => {
  exited = true;
  exitCode = code;
  exitSignal = signal;
  setTimeout(() => {
    if (!completed && !readReportIfReady()) {
      console.error(`[tauri-smoke-win-x64] app exited before smoke report: code=${String(exitCode)} signal=${String(exitSignal)}`);
      printDiagnostics();
      finish(1);
    }
  }, 500);
});

const pollTimer = setInterval(() => {
  readReportIfReady();
}, 500);

const timeoutTimer = setTimeout(() => {
  if (!allowNativeFallback) {
    console.error(`[tauri-smoke-win-x64] WebView smoke report was not written within ${startupWindowMs}ms.`);
    printDiagnostics();
    if (!exited) {
      child.kill();
    }
    finish(1);
    return;
  }
  console.warn(`[tauri-smoke-win-x64] WebView smoke report was not written within ${startupWindowMs}ms; trying explicit native fallback.`);
  if (!exited) {
    child.kill();
  }
  spawnSync(exePath, [...smokeArgs, "--latotex-smoke-native-fallback"], {
    cwd: path.dirname(exePath),
    stdio: ["ignore", processLog, processLog],
    timeout: 30000,
    env: {
      ...process.env,
      LATOTEX_E2E_RUNTIME_ROOT: runtimeRoot,
      LATOTEX_SMOKE: "1",
      LATOTEX_SMOKE_NATIVE_FALLBACK: "1",
      LATOTEX_SMOKE_REPORT_PATH: reportPath,
      LATOTEX_SMOKE_PROGRESS_PATH: progressPath,
    },
  });
  if (!readReportIfReady()) {
    console.error("[tauri-smoke-win-x64] smoke report was not written by WebView or native fallback.");
    printDiagnostics();
    finish(1);
  }
}, startupWindowMs);
