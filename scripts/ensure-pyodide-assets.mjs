import fs from "node:fs";
import path from "node:path";

const pyodideSourceDir = path.resolve("node_modules/pyodide");
const targetDir = path.resolve("src-tauri/resources/core/pyodide");

const requiredFiles = [
  "pyodide.mjs",
  "pyodide.asm.js",
  "pyodide.asm.wasm",
  "pyodide-lock.json",
  "python_stdlib.zip",
];

if (!fs.existsSync(pyodideSourceDir)) {
  console.error("Pyodide package is missing. Run `pnpm install` to prepare local analysis wasm assets.");
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });

for (const file of requiredFiles) {
  const sourcePath = path.join(pyodideSourceDir, file);
  if (!fs.existsSync(sourcePath)) {
    console.error(`Missing pyodide source asset: ${sourcePath}`);
    process.exit(1);
  }
  const targetPath = path.join(targetDir, file);
  fs.copyFileSync(sourcePath, targetPath);
}

const unresolved = requiredFiles.filter((file) => !fs.existsSync(path.join(targetDir, file)));
if (unresolved.length > 0) {
  console.error("Pyodide side-load assets are still missing:");
  for (const file of unresolved) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}

console.log("Pyodide side-load assets prepared and verified");
