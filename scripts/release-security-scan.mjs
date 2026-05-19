import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirs = new Set([
  ".git",
  ".github",
  ".vite",
  "dist",
  "node_modules",
  "target",
]);
const ignoredPathParts = [
  "src-tauri/resources/core/drawio/vendor/",
  "src-tauri/resources/core/share-vendor/",
  "src-tauri/target/",
  "docs/AGENTS.archive.md",
];
const ignoredFiles = new Set([
  "pnpm-lock.yaml",
  "scripts/release-security-scan.mjs",
  "src-tauri/Cargo.lock",
]);
const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".rs",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const secretPatterns = [
  {
    id: "private-key",
    pattern: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i,
  },
  {
    id: "github-token",
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{36,255}\b/,
  },
  {
    id: "aws-access-key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    id: "slack-token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  },
  {
    id: "openai-api-key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/,
  },
  {
    id: "wildcard-cors",
    pattern: /Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*/i,
  },
];

const allowedFixtures = new Set([
  "src-tauri/src/secure.rs:openai-api-key:LATOTEX_REDACTED_OPENAI_KEY",
]);

function toRepoPath(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
}

function shouldSkipFile(filePath) {
  const repoPath = toRepoPath(filePath);
  if (ignoredFiles.has(repoPath)) {
    return true;
  }
  return ignoredPathParts.some((part) => repoPath.startsWith(part));
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        walk(fullPath, files);
      }
      continue;
    }
    if (!textExtensions.has(path.extname(entry.name)) || shouldSkipFile(fullPath)) {
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

function lineForIndex(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

const findings = [];
for (const filePath of walk(repoRoot)) {
  const content = fs.readFileSync(filePath, "utf8");
  for (const { id, pattern } of secretPatterns) {
    const match = pattern.exec(content);
    if (!match) {
      continue;
    }
    const matchedText = match[0];
    const fixtureKey = `${toRepoPath(filePath)}:${id}:${matchedText}`;
    if (allowedFixtures.has(fixtureKey)) {
      continue;
    }
    findings.push({
      id,
      path: toRepoPath(filePath),
      line: lineForIndex(content, match.index),
    });
  }
}

function readRepoText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function addFinding(id, repoPath, line = 1) {
  findings.push({ id, path: repoPath, line });
}

function assertReleaseConfiguration() {
  const packageJson = JSON.parse(readRepoText("package.json"));
  const scripts = packageJson.scripts ?? {};
  if (!String(scripts["tauri:build:win-x64"] ?? "").includes("x86_64-pc-windows-msvc")) {
    addFinding("release-target-drift", "package.json");
  }
  if (!String(scripts["tauri:build:win-x64"] ?? "").includes("--bundles nsis")) {
    addFinding("release-bundle-drift", "package.json");
  }
  for (const scriptName of Object.keys(scripts)) {
    if (/sign|signtool|pfx/i.test(scriptName)) {
      addFinding("release-signing-script-present", "package.json");
    }
  }
  if (!scripts["release:package:win-x64"]) {
    addFinding("missing-package-gate", "package.json");
  }
  if (!scripts["release:install-smoke:win-x64"]) {
    addFinding("missing-install-smoke-gate", "package.json");
  }
  if (!String(scripts["soak:matrix"] ?? "").includes("gui-soak-win-x64.mjs")) {
    addFinding("soak-matrix-not-gui", "package.json");
  }

  const tauriConfig = JSON.parse(readRepoText("src-tauri/tauri.conf.json"));
  if (!tauriConfig.app?.security?.csp || tauriConfig.app.security.csp === null) {
    addFinding("tauri-csp-null", "src-tauri/tauri.conf.json");
  }
  if (tauriConfig.bundle?.targets !== "nsis") {
    addFinding("tauri-bundle-target-drift", "src-tauri/tauri.conf.json");
  }

  const capability = JSON.parse(readRepoText("src-tauri/capabilities/default.json"));
  if (!Array.isArray(capability.windows) || capability.windows.length !== 1 || capability.windows[0] !== "main") {
    addFinding("tauri-capability-window-drift", "src-tauri/capabilities/default.json");
  }

  const releaseWorkflow = readRepoText(".github/workflows/release-tauri.yml");
  if (!releaseWorkflow.includes("windows-latest") || releaseWorkflow.includes("ubuntu-latest") || releaseWorkflow.includes("macos-latest")) {
    addFinding("release-workflow-target-drift", ".github/workflows/release-tauri.yml");
  }
  if (!releaseWorkflow.includes("release:package:win-x64")) {
    addFinding("release-workflow-package-drift", ".github/workflows/release-tauri.yml");
  }
  if (/release:package:win-x64:signed|LATOTEX_SIGN|require-signing|signtool|PFX/i.test(releaseWorkflow)) {
    addFinding("release-workflow-signing-present", ".github/workflows/release-tauri.yml");
  }
}

assertReleaseConfiguration();

if (findings.length > 0) {
  console.error("[release-security-scan] high-risk findings detected:");
  for (const finding of findings) {
    console.error(`- ${finding.id}: ${finding.path}:${finding.line}`);
  }
  process.exit(1);
}

console.log("[release-security-scan] no high-risk local secrets or wildcard CORS patterns found.");
