import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(repoRoot, "src-tauri", "target", "x86_64-pc-windows-msvc", "release");
const nsisDir = path.join(releaseDir, "bundle", "nsis");
const reportDir = path.join(repoRoot, "dist", "release");
const metadataPath = path.join(reportDir, "windows-x64-package.json");
const timeoutMs = Number(process.env.LATOTEX_PACKAGE_WIN_X64_TIMEOUT_MS ?? 30 * 60 * 1000);
const graceMs = Number(process.env.LATOTEX_PACKAGE_WIN_X64_GRACE_MS ?? 60 * 1000);
const command = ["pnpm", ["tauri", "build", "--target", "x86_64-pc-windows-msvc", "--bundles", "nsis"]];

function rel(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
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

function statSummary(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  const stat = fs.statSync(filePath);
  return {
    path: rel(filePath),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    mtimeIso: stat.mtime.toISOString(),
  };
}

function processDiagnostics() {
  if (process.platform !== "win32") {
    return "";
  }
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    "Get-Process | Where-Object { $_.ProcessName -match 'makensis|tauri|cargo|rustc|pnpm|node' } | Select-Object Id,ProcessName,CPU,StartTime | Format-Table -AutoSize",
  ], { encoding: "utf8", shell: false });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}

function writeMetadata(metadata) {
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function stopProcessTree(pid) {
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "inherit", shell: false });
    return;
  }
  try {
    process.kill(pid);
  } catch {
    // Process may already have exited.
  }
}

if (process.platform !== "win32") {
  console.log("[package-win-x64] skipped: Windows x64 packaging must run on Windows.");
  process.exit(0);
}

fs.mkdirSync(reportDir, { recursive: true });
const startedAtMs = Date.now() - 1000;
const startedAt = new Date().toISOString();
const beforeInstaller = statSummary(newestInstaller());
const logPath = path.join(reportDir, `package-win-x64-${nowStamp()}.log`);
const logStream = fs.createWriteStream(logPath, { flags: "a" });
const [bin, args] = command;
console.log(`[package-win-x64] ${[bin, ...args].join(" ")}`);
console.log(`[package-win-x64] log: ${rel(logPath)}`);

const child = spawn(bin, args, {
  cwd: repoRoot,
  shell: process.platform === "win32",
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});

for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    process.stdout.write(chunk);
    logStream.write(chunk);
  });
}

let timeoutHandle;
let timedOut = false;
const status = await new Promise((resolve) => {
  let settled = false;
  const finish = (value) => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timeoutHandle);
    resolve(value);
  };
  child.once("close", (code, signal) => finish({ code, signal }));
  child.once("error", (error) => finish({ code: 1, signal: null, error }));
  timeoutHandle = setTimeout(() => {
    timedOut = true;
    console.error(`[package-win-x64] timed out after ${timeoutMs}ms; waiting ${graceMs}ms before cleanup diagnostics.`);
    const diagnostics = processDiagnostics();
    if (diagnostics) {
      console.error(`[package-win-x64] active build processes:\n${diagnostics}`);
    }
    sleep(graceMs);
    const afterGraceInstaller = statSummary(newestInstaller());
    writeMetadata({
      schema: "latotex.windows-x64-package.v1",
      ok: false,
      status: "timeout",
      startedAt,
      startedAtMs,
      finishedAt: new Date().toISOString(),
      command: [bin, ...args],
      timeoutMs,
      beforeInstaller,
      installer: afterGraceInstaller,
      logPath: rel(logPath),
    });
    if (child.pid) {
      stopProcessTree(child.pid);
    }
    finish({ code: 1, signal: "timeout" });
  }, timeoutMs);
});
logStream.end();

const installer = newestInstaller();
const installerSummary = statSummary(installer);
const exeSummary = statSummary(path.join(releaseDir, "latotex.exe"));
const metadata = {
  schema: "latotex.windows-x64-package.v1",
  ok: !timedOut && status.code === 0,
  status: timedOut ? "timeout" : status.code === 0 ? "passed" : "failed",
  startedAt,
  startedAtMs,
  finishedAt: new Date().toISOString(),
  command: [bin, ...args],
  exitCode: status.code,
  exitSignal: status.signal,
  beforeInstaller,
  installer: installerSummary,
  executable: exeSummary,
  logPath: rel(logPath),
};
writeMetadata(metadata);

if (status.error) {
  console.error(`[package-win-x64] failed to start: ${status.error.message}`);
  process.exit(1);
}
if (timedOut || status.code !== 0) {
  console.error(`[package-win-x64] package command failed; metadata: ${rel(metadataPath)}`);
  process.exit(status.code ?? 1);
}
if (!installer || !installerSummary || installerSummary.mtimeMs < startedAtMs) {
  console.error("[package-win-x64] package command exited successfully but did not refresh a NSIS installer.");
  console.error(`[package-win-x64] metadata: ${rel(metadataPath)}`);
  process.exit(1);
}
if (!exeSummary || exeSummary.mtimeMs < startedAtMs) {
  console.error("[package-win-x64] package command exited successfully but did not refresh latotex.exe.");
  console.error(`[package-win-x64] metadata: ${rel(metadataPath)}`);
  process.exit(1);
}
if (installerSummary.size < 10 * 1024 * 1024) {
  console.error(`[package-win-x64] installer is unexpectedly small: ${installerSummary.size} bytes.`);
  console.error(`[package-win-x64] metadata: ${rel(metadataPath)}`);
  process.exit(1);
}

console.log(`[package-win-x64] installer ready: ${installerSummary.path} (${installerSummary.size} bytes)`);
console.log(`[package-win-x64] metadata: ${rel(metadataPath)}`);
