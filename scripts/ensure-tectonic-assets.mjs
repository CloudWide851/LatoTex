import fs from "node:fs";
import path from "node:path";

const tectonicDir = path.resolve("src-tauri/resources/tools/tectonic");
const requiredFiles = [
  "windows-x64/tectonic.exe",
];

const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(tectonicDir, file)));

if (missing.length > 0) {
  console.error(
    [
      "Bundled Tectonic assets are missing.",
      "Ensure src-tauri/resources/tools/tectonic is populated before building release artifacts.",
      ...missing.map((file) => `- src-tauri/resources/tools/tectonic/${file}`),
    ].join("\n"),
  );
  process.exit(1);
}

console.log("Bundled Tectonic assets ready");
