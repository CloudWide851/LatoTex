import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const sideLoadRoot = "src-tauri/resources/core";
const sideLoadBusytexDir = path.join(sideLoadRoot, "busytex");
const legacyPublicBusytexDir = "public/core/busytex";

const requiredFiles = [
  path.join(sideLoadBusytexDir, "busytex.js"),
  path.join(sideLoadBusytexDir, "busytex.wasm"),
  path.join(sideLoadBusytexDir, "busytex_worker.js"),
  path.join(sideLoadBusytexDir, "busytex_pipeline.js"),
  path.join(sideLoadBusytexDir, "texlive-basic.js"),
];

const missing = requiredFiles.filter((file) => !fs.existsSync(file));
if (missing.length === 0) {
  console.log("BusyTeX side-load assets ready");
  if (fs.existsSync(legacyPublicBusytexDir)) {
    fs.rmSync(legacyPublicBusytexDir, { recursive: true, force: true });
  }
  process.exit(0);
}

console.log("BusyTeX side-load assets missing, downloading...");
fs.mkdirSync(sideLoadRoot, { recursive: true });
const result = spawnSync("pnpm", ["exec", "texlyre-busytex", "download-assets", `./${sideLoadRoot}`], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.status !== 0) {
  console.warn("BusyTeX assets download failed, continuing build without local assets.");
}

const unresolved = requiredFiles.filter((file) => !fs.existsSync(file));
if (unresolved.length > 0) {
  console.warn("BusyTeX side-load assets are still missing:");
  for (const file of unresolved) {
    console.warn(`- ${file}`);
  }
  console.warn(
    "LaTeX compilation will not work until side-load assets are available. Run `pnpm run busytex:assets` when network access is available.",
  );
  process.exit(0);
}

if (fs.existsSync(legacyPublicBusytexDir)) {
  fs.rmSync(legacyPublicBusytexDir, { recursive: true, force: true });
}

console.log("BusyTeX side-load assets downloaded and verified");
