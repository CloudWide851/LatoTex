import fs from "node:fs";
import path from "node:path";

const tectonicDir = path.resolve("src-tauri/resources/tools/tectonic");
const requiredFiles = [
  "windows-x64/tectonic.exe",
  "bundles/tlextras-2022.0r0.tar",
  "pfb/cmex10.pfb",
  "pfb/cmmi7.pfb",
];
const requiredCacheSeedDirs = ["files", "indexes", "manifests"];
const requiredIndexMarkers = ["pdftex.map", "glyphlist.txt", "cmex10.pfb"];
const errors = [];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(tectonicDir, file))) {
    errors.push(`missing file: src-tauri/resources/tools/tectonic/${file}`);
  }
}

for (const dir of requiredCacheSeedDirs) {
  if (!fs.existsSync(path.join(tectonicDir, "cache-seed", dir))) {
    errors.push(`missing directory: src-tauri/resources/tools/tectonic/cache-seed/${dir}`);
  }
}

const pfbDir = path.join(tectonicDir, "pfb");
const pfbFiles = fs.existsSync(pfbDir)
  ? fs.readdirSync(pfbDir).filter((file) => file.toLowerCase().endsWith(".pfb"))
  : [];
if (pfbFiles.length < 80) {
  errors.push(`expected at least 80 bundled PFB files, found ${pfbFiles.length}`);
}

const bundleTar = path.join(tectonicDir, "bundles", "tlextras-2022.0r0.tar");
if (fs.existsSync(bundleTar) && fs.statSync(bundleTar).size < 300_000_000) {
  errors.push("bundled Tectonic tarball is unexpectedly small");
}

const cacheIndexDir = path.join(tectonicDir, "cache-seed", "indexes");
const firstIndexFile = fs.existsSync(cacheIndexDir)
  ? fs.readdirSync(cacheIndexDir).find((file) => file.toLowerCase().endsWith(".txt"))
  : null;
if (!firstIndexFile) {
  errors.push("bundled Tectonic cache seed index is missing");
} else {
  const indexText = fs.readFileSync(path.join(cacheIndexDir, firstIndexFile), "utf8");
  for (const marker of requiredIndexMarkers) {
    if (!indexText.includes(marker)) {
      errors.push(`bundled Tectonic cache seed index is missing marker: ${marker}`);
    }
  }
}

if (errors.length > 0) {
  console.error(
    [
      "Bundled Tectonic assets are incomplete.",
      ...errors.map((item) => `- ${item}`),
    ].join("\n"),
  );
  process.exit(1);
}

console.log("Bundled Tectonic assets ready");

