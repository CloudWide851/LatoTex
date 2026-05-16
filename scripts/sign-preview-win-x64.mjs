import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireSigning = process.env.LATOTEX_REQUIRE_SIGNING === "1";
const nsisDir = path.join(repoRoot, "src-tauri", "target", "x86_64-pc-windows-msvc", "release", "bundle", "nsis");

function failOrSkip(message) {
  if (requireSigning) {
    console.error(`[sign-preview-win-x64] ${message}`);
    process.exit(1);
  }
  console.log(`[sign-preview-win-x64] skipped: ${message}`);
}

if (process.platform !== "win32") {
  failOrSkip("Windows signtool preview only runs on Windows.");
  process.exit(0);
}

const signtool = spawnSync("where.exe", ["signtool"], { encoding: "utf8", shell: true });
if (signtool.status !== 0) {
  failOrSkip("signtool.exe was not found on PATH.");
  process.exit(0);
}

if (!fs.existsSync(nsisDir)) {
  failOrSkip(`NSIS bundle directory not found: ${path.relative(repoRoot, nsisDir)}`);
  process.exit(0);
}

const installer = fs.readdirSync(nsisDir)
  .filter((name) => name.toLowerCase().endsWith(".exe"))
  .map((name) => path.join(nsisDir, name))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
if (!installer) {
  failOrSkip("no Windows installer exe found.");
  process.exit(0);
}

const hasThumbprint = Boolean(process.env.LATOTEX_SIGN_CERT_SHA1);
const hasCertPath = Boolean(process.env.LATOTEX_SIGN_CERT_PATH);
const hasTimestamp = Boolean(process.env.LATOTEX_SIGN_TIMESTAMP_URL);
if (!hasThumbprint && !hasCertPath) {
  failOrSkip("LATOTEX_SIGN_CERT_SHA1 or LATOTEX_SIGN_CERT_PATH is not configured.");
  process.exit(0);
}

console.log("[sign-preview-win-x64] signing prerequisites detected:");
console.log(`- signtool: ${signtool.stdout.trim().split(/\r?\n/)[0]}`);
console.log(`- installer: ${path.relative(repoRoot, installer)}`);
console.log(`- certificate: ${hasThumbprint ? "thumbprint" : "pfx path"}`);
console.log(`- timestamp: ${hasTimestamp ? "configured" : "not configured"}`);
console.log("[sign-preview-win-x64] preview only; no installer bytes were modified.");
