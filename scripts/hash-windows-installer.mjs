import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nsisDir = path.join(repoRoot, "src-tauri", "target", "x86_64-pc-windows-msvc", "release", "bundle", "nsis");
const packageMetadataPath = path.join(repoRoot, "dist", "release", "windows-x64-package.json");
const allowExisting = process.argv.includes("--allow-existing") || process.env.LATOTEX_HASH_ALLOW_EXISTING === "1";

function toRepoPath(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
}

function readPackageMetadata() {
  if (!fs.existsSync(packageMetadataPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(packageMetadataPath, "utf8"));
}

if (!fs.existsSync(nsisDir)) {
  console.error(`[hash-windows-installer] NSIS bundle directory not found: ${path.relative(repoRoot, nsisDir)}`);
  process.exit(1);
}

const installers = fs.readdirSync(nsisDir)
  .filter((name) => name.toLowerCase().endsWith(".exe"))
  .map((name) => path.join(nsisDir, name))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

if (installers.length === 0) {
  console.error("[hash-windows-installer] no Windows installer exe found.");
  process.exit(1);
}

const installer = installers[0];
const installerStat = fs.statSync(installer);
const metadata = readPackageMetadata();
if (!metadata && !allowExisting) {
  console.error("[hash-windows-installer] package metadata is missing; run pnpm release:build-installer:win-x64 first.");
  process.exit(1);
}
if (metadata) {
  if (metadata.schema !== "latotex.windows-x64-package.v1" || !metadata.ok || metadata.status !== "passed") {
    console.error("[hash-windows-installer] package metadata does not describe a passed Windows x64 build.");
    process.exit(1);
  }
  if (metadata.installer?.path !== toRepoPath(installer)) {
    console.error(`[hash-windows-installer] newest installer does not match package metadata: ${toRepoPath(installer)} !== ${metadata.installer?.path}`);
    process.exit(1);
  }
  if (metadata.installer?.size !== installerStat.size || installerStat.mtimeMs < Number(metadata.startedAtMs ?? 0)) {
    console.error("[hash-windows-installer] installer changed or predates the package metadata.");
    process.exit(1);
  }
}
const hash = crypto.createHash("sha256")
  .update(fs.readFileSync(installer))
  .digest("hex");
const hashPath = `${installer}.sha256`;
fs.writeFileSync(hashPath, `${hash}  ${path.basename(installer)}\n`);
console.log(`[hash-windows-installer] ${hash}  ${toRepoPath(installer)}`);
console.log(`[hash-windows-installer] wrote ${toRepoPath(hashPath)}`);
