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
const markdownReportPath = path.join(artifactsDir, "perf-baseline.md");
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

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function escapeMarkdownCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.map(escapeMarkdownCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeMarkdownCell).join(" | ")} |`),
  ].join("\n");
}

function renderMarkdownReport() {
  const largestAssets = report.dist.largestAssets.length > 0
    ? markdownTable(
      ["Asset", "Size"],
      report.dist.largestAssets.map((asset) => [asset.path, formatBytes(asset.bytes)]),
    )
    : "_No built assets were found._";
  const budgetChecks = report.dist.budgetChecks.length > 0
    ? markdownTable(
      ["Budget", "Asset", "Size", "Limit", "Status"],
      report.dist.budgetChecks.map((check) => [
        check.label,
        check.path || "missing",
        formatBytes(check.bytes),
        formatBytes(check.maxBytes),
        check.ok ? "pass" : "fail",
      ]),
    )
    : "_No built asset budgets were evaluated._";
  const largestSourceFiles = report.source.largestFiles.length > 0
    ? markdownTable(
      ["Source file", "Lines"],
      report.source.largestFiles.map((item) => [item.path, item.lines]),
    )
    : "_No source files were scanned._";
  return [
    "# LatoTex Performance Baseline",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Total runtime: ${report.timings.totalMs} ms`,
    `- Source scan: ${report.timings.sourceScanMs ?? 0} ms`,
    `- Dist scan: ${report.timings.distScanMs ?? 0} ms`,
    `- Dist assets: ${report.dist.assetCount} files / ${formatBytes(report.dist.totalAssetBytes)}`,
    `- Research eval: ${report.researchEval.status} (${report.researchEval.durationMs} ms)`,
    "",
    "## Budgets",
    "",
    `- Largest source file: ${report.budgets.largestSourceFileLines} lines`,
    `- Largest built asset: ${formatBytes(report.budgets.largestBuiltAssetBytes)}`,
    `- Total dist assets: ${formatBytes(report.budgets.totalDistAssetBytes)}`,
    `- Research eval duration: ${report.budgets.researchEvalDurationMs} ms`,
    "",
    "## Chunk Budget Checks",
    "",
    budgetChecks,
    "",
    "## Largest Built Assets",
    "",
    largestAssets,
    "",
    "## Largest Source Files",
    "",
    largestSourceFiles,
    "",
    "## Research Eval Tail",
    "",
    "```text",
    report.researchEval.outputTail || "(empty)",
    "```",
    "",
  ].join("\n");
}

function writeReports() {
  report.timings.totalMs = Math.round(performance.now() - totalStarted);
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownReportPath, renderMarkdownReport(), "utf8");
}

function fail(message, exitCode = 1) {
  writeReports();
  console.error(message);
  process.exit(exitCode);
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
  fail(`Missing required scripts: ${missingScripts.join(", ")}`);
}

const oversizedDistAsset = report.dist.largestAssets.find((asset) => asset.bytes > report.budgets.largestBuiltAssetBytes);
if (oversizedDistAsset) {
  fail(
    `Built asset exceeds ${report.budgets.largestBuiltAssetBytes} bytes: ${oversizedDistAsset.path} (${oversizedDistAsset.bytes})`,
  );
}

if (report.dist.exists && report.dist.totalAssetBytes > report.budgets.totalDistAssetBytes) {
  fail(
    `Total dist asset bytes exceed ${report.budgets.totalDistAssetBytes}: ${report.dist.totalAssetBytes}`,
  );
}

const failedDistBudget = report.dist.budgetChecks.find((check) => !check.ok);
if (failedDistBudget) {
  fail(
    `Built asset budget failed for ${failedDistBudget.label}: ${failedDistBudget.path || "missing"} ` +
    `(${failedDistBudget.bytes}/${failedDistBudget.maxBytes})`,
  );
}

if (report.researchEval.status !== "passed") {
  fail(
    `Research eval failed during performance baseline:\n${report.researchEval.outputTail}`,
    report.researchEval.exitCode ?? 1,
  );
}

if (report.researchEval.durationMs > report.budgets.researchEvalDurationMs) {
  fail(
    `Research eval exceeded ${report.budgets.researchEvalDurationMs}ms: ${report.researchEval.durationMs}ms`,
  );
}

writeReports();
console.log(JSON.stringify(report, null, 2));
