import fs from "node:fs";
import path from "node:path";

const sourceDir = path.resolve("src-tauri/resources/core/drawio");
const publicDir = path.resolve("public/core/drawio");
const requiredFiles = [
  "index.html",
  "app.html",
  "js/bootstrap.js",
  "js/main.js",
  "js/app.min.js",
  "js/extensions.min.js",
  "js/PreConfig.js",
  "js/PostConfig.js",
  "js/shapes-14-6-5.min.js",
  "js/stencils.min.js",
  "styles/grapheditor.css",
  "styles/high-contrast.css",
  "images/spin.gif",
];

const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(sourceDir, file)));

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

copyDirectoryRecursive(sourceDir, publicDir);

console.log("DrawIO frontend assets ready");
