import fs from "node:fs";
import path from "node:path";

const sideLoadBusytexDir = "src-tauri/resources/core/busytex";
const requiredFiles = [
  `${sideLoadBusytexDir}/busytex.js`,
  `${sideLoadBusytexDir}/busytex.wasm`,
  `${sideLoadBusytexDir}/busytex_worker.js`,
  `${sideLoadBusytexDir}/busytex_pipeline.js`,
  `${sideLoadBusytexDir}/texlive-basic.js`,
];

const missing = requiredFiles.filter((file) => !fs.existsSync(path.resolve(file)));

if (missing.length > 0) {
  console.warn(
    [
      "BusyTeX side-load assets are missing.",
      "Run `pnpm run busytex:assets` before building release artifacts.",
      ...missing.map((file) => `- ${file}`),
    ].join("\n"),
  );
}
