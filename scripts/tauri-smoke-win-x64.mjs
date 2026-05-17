import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exePath = path.join(repoRoot, "src-tauri", "target", "x86_64-pc-windows-msvc", "release", "LatoTex.exe");
const startupWindowMs = Number(process.env.LATOTEX_SMOKE_STARTUP_MS ?? 60000);

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
console.log(`[tauri-smoke-win-x64] runtime root: ${runtimeRoot}`);
const child = spawn(exePath, [], {
  cwd: path.dirname(exePath),
  detached: false,
  stdio: "ignore",
  env: {
    ...process.env,
    LATOTEX_E2E_RUNTIME_ROOT: runtimeRoot,
    LATOTEX_SMOKE: "1",
    LATOTEX_SMOKE_REPORT_PATH: reportPath,
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

child.once("exit", (code, signal) => {
  exited = true;
  exitCode = code;
  exitSignal = signal;
  setTimeout(() => {
    if (!completed && !readReportIfReady()) {
      console.error(`[tauri-smoke-win-x64] app exited before smoke report: code=${String(exitCode)} signal=${String(exitSignal)}`);
      finish(1);
    }
  }, 500);
});

const pollTimer = setInterval(() => {
  readReportIfReady();
}, 500);

const timeoutTimer = setTimeout(() => {
  console.warn(`[tauri-smoke-win-x64] WebView smoke report was not written within ${startupWindowMs}ms; trying native fallback.`);
  if (!exited) {
    child.kill();
  }
  spawnSync(exePath, [], {
    cwd: path.dirname(exePath),
    stdio: "ignore",
    timeout: 30000,
    env: {
      ...process.env,
      LATOTEX_E2E_RUNTIME_ROOT: runtimeRoot,
      LATOTEX_SMOKE: "1",
      LATOTEX_SMOKE_NATIVE_FALLBACK: "1",
      LATOTEX_SMOKE_REPORT_PATH: reportPath,
    },
  });
  if (!readReportIfReady()) {
    console.error("[tauri-smoke-win-x64] smoke report was not written by WebView or native fallback.");
    finish(1);
  }
}, startupWindowMs);
