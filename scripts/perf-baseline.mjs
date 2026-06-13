import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(repoRoot, "dist");
const srcDir = path.join(repoRoot, "src");
const artifactsDir = path.join(repoRoot, "artifacts");
const reportPath = path.join(artifactsDir, "perf-baseline.json");
const report = {
  generatedAt: new Date().toISOString(),
  budgets: {
    largestSourceFileLines: 600,
    largestBuiltAssetBytes: 5 * 1024 * 1024,
    totalDistAssetBytes: 12 * 1024 * 1024,
    researchEvalDurationMs: 60_000,
    distAssets: {
      vendorMonacoBytes: 4 * 1024 * 1024,
      vendorMonacoLanguagesBytes: 256 * 1024,
      pdfWorkerBytes: 1.6 * 1024 * 1024,
      vendorExceljsBytes: 1.1 * 1024 * 1024,
      indexBytes: 720 * 1024,
      appWorkspaceShellBytes: 560 * 1024,
    },
  },
  timings: {
    totalMs: 0,
  },
  scripts: {},
  source: {
    fileCount: 0,
    largestFiles: [],
  },
  dist: {
    exists: fs.existsSync(distDir),
    largestAssets: [],
    assetCount: 0,
    totalAssetBytes: 0,
    budgetChecks: [],
  },
  researchEval: {
    status: "not_run",
    durationMs: 0,
    exitCode: null,
    outputTail: "",
  },
};

const totalStarted = performance.now();

function measure(label, fn) {
  const started = performance.now();
  const value = fn();
  report.timings[label] = Math.round(performance.now() - started);
  return value;
}

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

const distAssetBudgetRules = [
  { name: "vendorMonacoBytes", label: "vendor-monaco", pattern: /dist\/assets\/vendor-monaco-[^/]+\.js$/ },
  { name: "vendorMonacoLanguagesBytes", label: "vendor-monaco-languages", pattern: /dist\/assets\/vendor-monaco-languages-[^/]+\.js$/ },
  { name: "pdfWorkerBytes", label: "pdf.worker", pattern: /dist\/assets\/pdf\.worker\.min-[^/]+\.mjs$/ },
  { name: "vendorExceljsBytes", label: "vendor-exceljs", pattern: /dist\/assets\/vendor-exceljs-[^/]+\.js$/ },
  { name: "indexBytes", label: "index", pattern: /dist\/assets\/index-[^/]+\.js$/ },
  { name: "appWorkspaceShellBytes", label: "AppWorkspaceShell", pattern: /dist\/assets\/AppWorkspaceShell-[^/]+\.js$/ },
];

const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
for (const scriptName of [
  "arch:check",
  "typecheck",
  "test:unit",
  "test:e2e",
  "perf:baseline",
  "build",
  "tauri:build:win-x64",
  "release:validate:win-x64",
  "release:package:win-x64",
  "release:install-smoke:win-x64",
  "release:check:win-x64",
  "tauri:smoke:win-x64",
  "soak:matrix",
]) {
  report.scripts[scriptName] = Boolean(packageJson.scripts?.[scriptName]);
}

measure("sourceScanMs", () => {
  const sourceFiles = walkFiles(srcDir, (filePath) => [".ts", ".tsx"].includes(path.extname(filePath)));
  report.source.fileCount = sourceFiles.length;
  report.source.largestFiles = sourceFiles
    .map((filePath) => ({
      path: path.relative(repoRoot, filePath).replaceAll(path.sep, "/"),
      lines: fs.readFileSync(filePath, "utf8").split(/\r?\n/).length,
    }))
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 10);
});

if (report.dist.exists) {
  measure("distScanMs", () => {
    const assets = walkFiles(distDir, isBudgetedDistAsset)
      .map((filePath) => ({
        path: path.relative(repoRoot, filePath).replaceAll(path.sep, "/"),
        bytes: fs.statSync(filePath).size,
      }))
      .sort((a, b) => b.bytes - a.bytes);
    report.dist.assetCount = assets.length;
    report.dist.totalAssetBytes = assets.reduce((total, asset) => total + asset.bytes, 0);
    report.dist.largestAssets = assets.slice(0, 10);
    report.dist.budgetChecks = distAssetBudgetRules.map((rule) => {
      const matched = assets.find((asset) => rule.pattern.test(asset.path));
      const maxBytes = report.budgets.distAssets[rule.name];
      return {
        label: rule.label,
        path: matched?.path ?? "",
        bytes: matched?.bytes ?? 0,
        maxBytes,
        ok: Boolean(matched) && matched.bytes <= maxBytes,
      };
    });
  });
}

const researchEvalStarted = performance.now();
const researchEvalResult = spawnSync("pnpm", ["research:eval"], {
  cwd: repoRoot,
  encoding: "utf8",
  shell: process.platform === "win32",
});
const researchEvalDurationMs = Math.round(performance.now() - researchEvalStarted);
const researchEvalOutput = `${researchEvalResult.stdout ?? ""}\n${researchEvalResult.stderr ?? ""}`.trim();
report.timings.researchEvalMs = researchEvalDurationMs;
report.researchEval = {
  status: researchEvalResult.status === 0 ? "passed" : "failed",
  durationMs: researchEvalDurationMs,
  exitCode: researchEvalResult.status ?? 1,
  outputTail: researchEvalOutput.split(/\r?\n/).slice(-20).join("\n"),
};

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

if (report.dist.exists && report.dist.totalAssetBytes > report.budgets.totalDistAssetBytes) {
  console.error(
    `Total dist asset bytes exceed ${report.budgets.totalDistAssetBytes}: ${report.dist.totalAssetBytes}`,
  );
  process.exit(1);
}

const failedDistBudget = report.dist.budgetChecks.find((check) => !check.ok);
if (failedDistBudget) {
  console.error(
    `Built asset budget failed for ${failedDistBudget.label}: ${failedDistBudget.path || "missing"} ` +
    `(${failedDistBudget.bytes}/${failedDistBudget.maxBytes})`,
  );
  process.exit(1);
}

if (report.researchEval.status !== "passed") {
  console.error(`Research eval failed during performance baseline:\n${report.researchEval.outputTail}`);
  process.exit(report.researchEval.exitCode ?? 1);
}

if (report.researchEval.durationMs > report.budgets.researchEvalDurationMs) {
  console.error(
    `Research eval exceeded ${report.budgets.researchEvalDurationMs}ms: ${report.researchEval.durationMs}ms`,
  );
  process.exit(1);
}

report.timings.totalMs = Math.round(performance.now() - totalStarted);
fs.mkdirSync(artifactsDir, { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
