import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(repoRoot, "dist");
const srcDir = path.join(repoRoot, "src");
const report = {
  generatedAt: new Date().toISOString(),
  budgets: {
    largestSourceFileLines: 600,
    largestBuiltAssetBytes: 5 * 1024 * 1024,
  },
  scripts: {},
  source: {
    fileCount: 0,
    largestFiles: [],
  },
  dist: {
    exists: fs.existsSync(distDir),
    largestAssets: [],
  },
};

function walkFiles(dir, predicate, out = []) {
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "target") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, predicate, out);
      continue;
    }
    if (!predicate || predicate(fullPath)) {
      out.push(fullPath);
    }
  }
  return out;
}

function isBudgetedDistAsset(filePath) {
  const relative = path.relative(distDir, filePath).replaceAll(path.sep, "/");
  return relative.startsWith("assets/") || relative === "index.html";
}

const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
for (const scriptName of ["arch:check", "typecheck", "test:unit", "test:e2e", "perf:baseline", "build", "tauri:build:win-x64", "release:check:win-x64"]) {
  report.scripts[scriptName] = Boolean(packageJson.scripts?.[scriptName]);
}

const sourceFiles = walkFiles(srcDir, (filePath) => [".ts", ".tsx"].includes(path.extname(filePath)));
report.source.fileCount = sourceFiles.length;
report.source.largestFiles = sourceFiles
  .map((filePath) => ({
    path: path.relative(repoRoot, filePath).replaceAll(path.sep, "/"),
    lines: fs.readFileSync(filePath, "utf8").split(/\r?\n/).length,
  }))
  .sort((a, b) => b.lines - a.lines)
  .slice(0, 10);

if (report.dist.exists) {
  report.dist.largestAssets = walkFiles(distDir, isBudgetedDistAsset)
    .map((filePath) => ({
      path: path.relative(repoRoot, filePath).replaceAll(path.sep, "/"),
      bytes: fs.statSync(filePath).size,
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10);
}

const missingScripts = Object.entries(report.scripts)
  .filter(([, exists]) => !exists)
  .map(([name]) => name);
if (missingScripts.length > 0) {
  console.error(`Missing required scripts: ${missingScripts.join(", ")}`);
  process.exit(1);
}

const oversizedDistAsset = report.dist.largestAssets.find((asset) => asset.bytes > report.budgets.largestBuiltAssetBytes);
if (oversizedDistAsset) {
  console.error(
    `Built asset exceeds ${report.budgets.largestBuiltAssetBytes} bytes: ${oversizedDistAsset.path} (${oversizedDistAsset.bytes})`,
  );
  process.exit(1);
}

console.log(JSON.stringify(report, null, 2));
