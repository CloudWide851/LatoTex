import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exePath = path.join(repoRoot, "src-tauri", "target", "x86_64-pc-windows-msvc", "release", "LatoTex.exe");
const startupWindowMs = Number(process.env.LATOTEX_SMOKE_STARTUP_MS ?? 5000);

if (process.platform !== "win32") {
  console.log("[tauri-smoke-win-x64] skipped: Windows x64 smoke must run on Windows.");
  process.exit(0);
}

if (!fs.existsSync(exePath)) {
  console.error(`[tauri-smoke-win-x64] executable not found: ${path.relative(repoRoot, exePath)}`);
  process.exit(1);
}

const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "latotex-smoke-"));
const child = spawn(exePath, [], {
  cwd: path.dirname(exePath),
  detached: false,
  stdio: "ignore",
  env: {
    ...process.env,
    LATOTEX_E2E_RUNTIME_ROOT: runtimeRoot,
    LATOTEX_SMOKE: "1",
  },
});

let exited = false;
child.once("exit", (code, signal) => {
  exited = true;
  if (code === 0) {
    console.log("[tauri-smoke-win-x64] app exited cleanly during smoke window.");
    process.exit(0);
  }
  console.error(`[tauri-smoke-win-x64] app exited early: code=${String(code)} signal=${String(signal)}`);
  process.exit(1);
});

setTimeout(() => {
  if (!exited) {
    child.kill();
    console.log(`[tauri-smoke-win-x64] app stayed alive for ${startupWindowMs}ms; startup smoke passed.`);
    process.exit(0);
  }
}, startupWindowMs);
