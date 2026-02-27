import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const sourceLogo = path.resolve("src/assets/branding/logo.svg");
const tauriLogo = path.resolve("src-tauri/icons/logo.svg");
const hashFile = path.resolve("src-tauri/icons/.brand-logo.sha256");
const force = process.argv.includes("--force");

if (!fs.existsSync(sourceLogo)) {
  console.error(`Brand logo is missing: ${sourceLogo}`);
  process.exit(1);
}

const sourceContent = fs.readFileSync(sourceLogo);
const sourceHash = crypto.createHash("sha256").update(sourceContent).digest("hex");

fs.mkdirSync(path.dirname(tauriLogo), { recursive: true });
if (!fs.existsSync(tauriLogo) || !sourceContent.equals(fs.readFileSync(tauriLogo))) {
  fs.writeFileSync(tauriLogo, sourceContent);
  console.log("Synced logo to src-tauri/icons/logo.svg");
}

const currentHash = fs.existsSync(hashFile) ? fs.readFileSync(hashFile, "utf8").trim() : "";
if (!force && currentHash === sourceHash) {
  console.log("Brand icons are up to date");
  process.exit(0);
}

console.log("Regenerating Tauri icons from canonical brand logo...");
const result = spawnSync("pnpm", ["exec", "tauri", "icon", "src-tauri/icons/logo.svg"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (result.status !== 0) {
  console.error("Failed to regenerate Tauri icons");
  process.exit(result.status ?? 1);
}

fs.writeFileSync(hashFile, `${sourceHash}\n`);
console.log("Brand icons regenerated and hash updated");

