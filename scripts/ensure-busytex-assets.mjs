import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const sideLoadRoot = "src-tauri/resources/core";
const sideLoadBusytexDir = path.resolve(sideLoadRoot, "busytex");
const publicBusytexDir = path.resolve("public/core/busytex");
const shouldMirrorPublic = process.env.LATOTEX_MIRROR_PUBLIC_BUSYTEX === "1";

const requiredFiles = [
  path.join(sideLoadBusytexDir, "busytex.js"),
  path.join(sideLoadBusytexDir, "busytex.wasm"),
  path.join(sideLoadBusytexDir, "busytex_worker.js"),
  path.join(sideLoadBusytexDir, "busytex_pipeline.js"),
  path.join(sideLoadBusytexDir, "texlive-basic.js"),
];

function copyDirectory(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
      continue;
    }
    if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function syncOptionalPublicMirror() {
  if (!shouldMirrorPublic) {
    fs.rmSync(publicBusytexDir, { recursive: true, force: true });
    console.log("BusyTeX side-load assets ready (public mirror disabled)");
    return;
  }
  fs.rmSync(publicBusytexDir, { recursive: true, force: true });
  copyDirectory(sideLoadBusytexDir, publicBusytexDir);
  console.log("BusyTeX side-load assets ready (mirrored to public/core/busytex)");
}

const missing = requiredFiles.filter((file) => !fs.existsSync(file));
if (missing.length === 0) {
  syncOptionalPublicMirror();
  process.exit(0);
}

console.log("BusyTeX side-load assets missing, downloading...");
fs.mkdirSync(path.resolve(sideLoadRoot), { recursive: true });
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

syncOptionalPublicMirror();
