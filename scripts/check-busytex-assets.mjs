import fs from "node:fs";
import path from "node:path";

const requiredFiles = [
  "public/core/busytex/busytex.js",
  "public/core/busytex/busytex.wasm",
  "public/core/busytex/busytex_worker.js",
  "public/core/busytex/texlive-basic.js",
];

const missing = requiredFiles.filter((file) => !fs.existsSync(path.resolve(file)));

if (missing.length > 0) {
  console.warn(
    [
      "BusyTeX assets are missing.",
      "Run `pnpm run busytex:assets` before building release artifacts.",
      ...missing.map((file) => `- ${file}`),
    ].join("\n"),
  );
}
