#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const requireTool = process.argv.includes("--require");
const json = process.argv.includes("--json");

function sdkBinRoots() {
  const roots = [
    process.env.WindowsSdkDir ? path.join(process.env.WindowsSdkDir, "bin") : null,
    process.env.WindowsSdkDir,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Windows Kits", "10", "bin") : null,
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Windows Kits", "10", "bin") : null,
  ].filter(Boolean);
  return Array.from(new Set(roots));
}

function findSdkSigntool() {
  const candidates = [];
  for (const root of sdkBinRoots()) {
    if (!fs.existsSync(root)) {
      continue;
    }
    const direct = path.join(root, "x64", "signtool.exe");
    if (fs.existsSync(direct)) {
      candidates.push(direct);
    }
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const candidate = path.join(root, entry.name, "x64", "signtool.exe");
      if (fs.existsSync(candidate)) {
        candidates.push(candidate);
      }
    }
  }
  return candidates.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0] ?? null;
}

function findSigntool() {
  const explicit = process.env.LATOTEX_SIGNTOOL_PATH;
  if (explicit && fs.existsSync(explicit)) {
    return { path: explicit, source: "LATOTEX_SIGNTOOL_PATH" };
  }
  const where = spawnSync("where.exe", ["signtool"], { encoding: "utf8", shell: true });
  if (where.status === 0) {
    const found = where.stdout.trim().split(/\r?\n/).find(Boolean);
    if (found) {
      return { path: found, source: "PATH" };
    }
  }
  const sdk = findSdkSigntool();
  return sdk ? { path: sdk, source: "Windows SDK" } : null;
}

const found = process.platform === "win32" ? findSigntool() : null;
if (json) {
  console.log(JSON.stringify({ ok: Boolean(found), signtool: found }, null, 2));
}
if (found) {
  if (!json) {
    console.log(`[ensure-signtool-win-x64] found ${found.path} (${found.source})`);
  }
  process.exit(0);
}

const message = [
  "[ensure-signtool-win-x64] signtool.exe was not found.",
  "Install the official Windows SDK Signing Tools, then set LATOTEX_SIGNTOOL_PATH or ensure signtool.exe is on PATH.",
  "Recommended installer source: Microsoft Windows SDK.",
].join("\n");
if (requireTool) {
  console.error(message);
  process.exit(1);
}
console.log(message);
