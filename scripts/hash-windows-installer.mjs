import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nsisDir = path.join(repoRoot, "src-tauri", "target", "x86_64-pc-windows-msvc", "release", "bundle", "nsis");

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
const hash = crypto.createHash("sha256")
  .update(fs.readFileSync(installer))
  .digest("hex");
const hashPath = `${installer}.sha256`;
fs.writeFileSync(hashPath, `${hash}  ${path.basename(installer)}\n`);
console.log(`[hash-windows-installer] ${hash}  ${path.relative(repoRoot, installer)}`);
console.log(`[hash-windows-installer] wrote ${path.relative(repoRoot, hashPath)}`);
