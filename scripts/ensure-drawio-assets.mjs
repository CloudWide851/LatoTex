import fs from "node:fs";
import path from "node:path";

const drawioDir = path.resolve("src-tauri/resources/core/drawio");
const requiredFiles = [
  "index.html",
  "app.html",
  "js/bootstrap.js",
  "js/main.js",
  "js/app.min.js",
  "styles/grapheditor.css",
  "styles/high-contrast.css",
  "images/spin.gif",
];

const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(drawioDir, file)));

if (missing.length > 0) {
  console.error(
    [
      "DrawIO side-load assets are missing.",
      "Ensure src-tauri/resources/core/drawio is populated before building release artifacts.",
      ...missing.map((file) => `- src-tauri/resources/core/drawio/${file}`),
    ].join("\n"),
  );
  process.exit(1);
}

console.log("DrawIO side-load assets ready");
