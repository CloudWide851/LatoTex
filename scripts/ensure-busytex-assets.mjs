import fs from "node:fs";
import { spawnSync } from "node:child_process";

const requiredFiles = [
  "public/core/busytex/busytex.js",
  "public/core/busytex/busytex.wasm",
  "public/core/busytex/busytex_worker.js",
  "public/core/busytex/texlive-basic.js",
];

const missing = requiredFiles.filter((file) => !fs.existsSync(file));
if (missing.length === 0) {
  console.log("BusyTeX assets ready");
  process.exit(0);
}

console.log("BusyTeX assets missing, downloading...");
const result = spawnSync("pnpm", ["exec", "texlyre-busytex", "download-assets", "./public/core"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.status !== 0) {
  console.warn("BusyTeX assets download failed, continuing build without local assets.");
}

const unresolved = requiredFiles.filter((file) => !fs.existsSync(file));
if (unresolved.length > 0) {
  console.warn("BusyTeX assets are still missing:");
  for (const file of unresolved) {
    console.warn(`- ${file}`);
  }
  console.warn(
    "LaTeX compilation will not work until assets are available. Run `pnpm run busytex:assets` when network access is available.",
  );
  process.exit(0);
}

console.log("BusyTeX assets downloaded and verified");
