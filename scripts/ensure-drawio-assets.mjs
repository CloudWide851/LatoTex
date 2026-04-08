import fs from "node:fs";
import path from "node:path";

const sourceDir = path.resolve("src-tauri/resources/core/drawio");
const publicDir = path.resolve("public/core/drawio");
const versionManifestPath = path.join(sourceDir, "drawio-version.json");
const requiredFiles = [
  "index.html",
  "drawio-version.json",
  "vendor/index.html",
  "vendor/js/bootstrap.js",
  "vendor/js/main.js",
  "vendor/js/app.min.js",
  "vendor/js/extensions.min.js",
  "vendor/js/PreConfig.js",
  "vendor/js/PostConfig.js",
  "vendor/js/shapes-14-6-5.min.js",
  "vendor/js/stencils.min.js",
  "vendor/styles/grapheditor.css",
  "vendor/styles/high-contrast.css",
  "vendor/images/spin.gif",
  "vendor/images/github-logo.svg",
  "vendor/mxgraph/css/common.css",
  "vendor/mxgraph/images/maximize.gif",
  "vendor/math4/es5/startup.js",
  "vendor/resources/dia.txt",
];

const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(sourceDir, file)));

function countFilesRecursive(root) {
  let count = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      count += countFilesRecursive(entryPath);
      continue;
    }
    count += 1;
  }
  return count;
}

function copyDirectoryRecursive(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, destinationPath);
      continue;
    }
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  }
}

if (missing.length > 0) {
  console.error(
    [
      "DrawIO frontend assets are missing.",
      "Ensure src-tauri/resources/core/drawio is populated before building release artifacts.",
      ...missing.map((file) => `- src-tauri/resources/core/drawio/${file}`),
    ].join("\n"),
  );
  process.exit(1);
}

if (!fs.existsSync(versionManifestPath)) {
  console.error("DrawIO version manifest is missing.");
  process.exit(1);
}

const versionManifest = JSON.parse(fs.readFileSync(versionManifestPath, "utf-8"));
const vendorDir = path.join(sourceDir, "vendor");
const actualFileCount = countFilesRecursive(vendorDir);
const expectedFileCount = Number(versionManifest?.vendor?.expectedFileCount ?? 0);

if (!Number.isInteger(expectedFileCount) || expectedFileCount <= 0) {
  console.error("DrawIO version manifest has an invalid expectedFileCount.");
  process.exit(1);
}

if (actualFileCount !== expectedFileCount) {
  console.error(
    [
      "DrawIO vendored webapp is incomplete.",
      `Expected ${expectedFileCount} files but found ${actualFileCount}.`,
      "Re-sync src-tauri/resources/core/drawio/vendor from the official source package before building.",
    ].join("\n"),
  );
  process.exit(1);
}

copyDirectoryRecursive(sourceDir, publicDir);

console.log("DrawIO frontend assets ready");
