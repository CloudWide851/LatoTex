import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  rewriteShareVendorImports,
  shouldSkipBrowserVendorFile,
  validateBrowserVendorTree,
} from "./share-web-assets-lib.mjs";

const require = createRequire(import.meta.url);
const vendorRoot = path.resolve("src-tauri/resources/core/share-vendor");
const lib0SkipDirs = new Set([".github", ".vscode", "bin", "coverage", "dist", "node_modules", "types"]);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(source, target) {
  ensureDir(path.dirname(target));
  fs.copyFileSync(source, target);
}

function removeDirContents(dir) {
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      fs.rmSync(target, { recursive: true, force: true });
      continue;
    }
    fs.rmSync(target, { force: true });
  }
}

function copyLib0Files(sourceDir, targetDir) {
  ensureDir(targetDir);
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (lib0SkipDirs.has(entry.name)) {
        continue;
      }
      copyLib0Files(path.join(sourceDir, entry.name), path.join(targetDir, entry.name));
      continue;
    }
    if (path.extname(entry.name) !== ".js" || shouldSkipBrowserVendorFile(entry.name)) {
      continue;
    }
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    const targetRelativePath = path.relative(vendorRoot, targetPath).replace(/\\/g, "/");
    const rewritten = rewriteShareVendorImports(fs.readFileSync(sourcePath, "utf8"), targetRelativePath);
    ensureDir(path.dirname(targetPath));
    fs.writeFileSync(targetPath, rewritten);
  }
}

function main() {
  const yjsPackagePath = require.resolve("yjs/package.json");
  const yjsRequire = createRequire(yjsPackagePath);
  const yjsDir = path.dirname(yjsPackagePath);
  const lib0Dir = path.dirname(yjsRequire.resolve("lib0/package.json"));
  const pdfMinPath = require.resolve("pdfjs-dist/build/pdf.min.mjs");
  const pdfWorkerPath = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
  const yjsSourcePath = path.join(yjsDir, "dist", "yjs.mjs");

  ensureDir(vendorRoot);
  removeDirContents(vendorRoot);

  copyFile(pdfMinPath, path.join(vendorRoot, "pdf.min.mjs"));
  copyFile(pdfWorkerPath, path.join(vendorRoot, "pdf.worker.min.mjs"));

  const yjsPatched = rewriteShareVendorImports(fs.readFileSync(yjsSourcePath, "utf8"), "yjs.mjs");
  fs.writeFileSync(path.join(vendorRoot, "yjs.mjs"), yjsPatched);

  copyLib0Files(lib0Dir, path.join(vendorRoot, "lib0"));
  const invalid = validateBrowserVendorTree(vendorRoot);
  if (invalid.length > 0) {
    const detail = invalid
      .map((item) => `${path.relative(process.cwd(), item.file)} -> ${item.specifiers.join(", ")}`)
      .join("\n");
    throw new Error(`Share web vendor assets contain unsupported bare imports:\n${detail}`);
  }
  console.log(`Share web vendor assets prepared in ${vendorRoot}`);
}

main();
