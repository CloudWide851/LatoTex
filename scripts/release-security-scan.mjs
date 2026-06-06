import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

const signingResiduePattern = /release:package:win-x64:signed|--require-signing|\bLATOTEX_SIGN\b|\bsigntool(?:\.exe)?\b|\.pfx\b|\bPFX\b|CODE_SIGN|WINDOWS_CERT/i;

function toRepoPath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
}

function shouldSkipFile(repoRoot, filePath) {
  const repoPath = toRepoPath(repoRoot, filePath);
  if (ignoredFiles.has(repoPath)) {
    return true;
  }
  return ignoredPathParts.some((part) => repoPath.startsWith(part));
}

function walk(repoRoot, dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        walk(repoRoot, fullPath, files);
      }
      continue;
    }
    if (!textExtensions.has(path.extname(entry.name)) || shouldSkipFile(repoRoot, fullPath)) {
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

function lineForIndex(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function scanTextFindings(repoRoot) {
  const findings = [];
  for (const filePath of walk(repoRoot, repoRoot)) {
    const content = fs.readFileSync(filePath, "utf8");
    for (const { id, pattern } of secretPatterns) {
      const match = pattern.exec(content);
      if (!match) {
        continue;
      }
      const matchedText = match[0];
      const fixtureKey = `${toRepoPath(repoRoot, filePath)}:${id}:${matchedText}`;
      if (allowedFixtures.has(fixtureKey)) {
        continue;
      }
      findings.push({
        id,
        path: toRepoPath(repoRoot, filePath),
        line: lineForIndex(content, match.index),
      });
    }
  }
  return findings;
}

function readRepoText(repoRoot, relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function addFinding(findings, id, repoPath, line = 1) {
  findings.push({ id, path: repoPath, line });
}

function releaseWorkflowHasWindowsTarget(workflowText) {
  return (
    workflowText.includes("windows-latest") &&
    workflowText.includes("x86_64-pc-windows-msvc") &&
    workflowText.includes("nsis")
  );
}

function assertReleaseConfiguration(repoRoot, findings) {
  const packageJson = JSON.parse(readRepoText(repoRoot, "package.json"));
  const scripts = packageJson.scripts ?? {};
  if (!String(scripts["tauri:build:win-x64"] ?? "").includes("x86_64-pc-windows-msvc")) {
    addFinding(findings, "release-target-drift", "package.json");
  }
  if (!String(scripts["tauri:build:win-x64"] ?? "").includes("--bundles nsis")) {
    addFinding(findings, "release-bundle-drift", "package.json");
  }
  if (!scripts["release:package:win-x64"]) {
    addFinding(findings, "missing-unsigned-package-gate", "package.json");
  }
  if (!scripts["release:install-smoke:win-x64"]) {
    addFinding(findings, "missing-install-smoke-gate", "package.json");
  }
  for (const [name, command] of Object.entries(scripts)) {
    if (signingResiduePattern.test(`${name} ${String(command)}`)) {
      addFinding(findings, "release-signing-flow-reintroduced", "package.json");
      break;
    }
  }

  const tauriConfig = JSON.parse(readRepoText(repoRoot, "src-tauri/tauri.conf.json"));
  if (!tauriConfig.app?.security?.csp || tauriConfig.app.security.csp === null) {
    addFinding(findings, "tauri-csp-null", "src-tauri/tauri.conf.json");
  }
  if (tauriConfig.bundle?.targets !== "nsis") {
    addFinding(findings, "tauri-bundle-target-drift", "src-tauri/tauri.conf.json");
  }

  const capability = JSON.parse(readRepoText(repoRoot, "src-tauri/capabilities/default.json"));
  if (!Array.isArray(capability.windows) || capability.windows.length !== 1 || capability.windows[0] !== "main") {
    addFinding(findings, "tauri-capability-window-drift", "src-tauri/capabilities/default.json");
  }

  const releaseWorkflow = readRepoText(repoRoot, ".github/workflows/release-tauri.yml");
  if (!releaseWorkflowHasWindowsTarget(releaseWorkflow)) {
    addFinding(findings, "release-workflow-target-drift", ".github/workflows/release-tauri.yml");
  }
  if (!releaseWorkflow.includes("release:package:win-x64")) {
    addFinding(findings, "release-workflow-missing-unsigned-package-gate", ".github/workflows/release-tauri.yml");
  }
  if (signingResiduePattern.test(releaseWorkflow)) {
    addFinding(findings, "release-workflow-signing-reintroduced", ".github/workflows/release-tauri.yml");
  }
}

export function scanRepository(repoRoot = defaultRepoRoot) {
  const resolvedRoot = path.resolve(repoRoot);
  const findings = scanTextFindings(resolvedRoot);
  assertReleaseConfiguration(resolvedRoot, findings);
  return findings;
}

function main() {
  const repoRoot = process.env.LATOTEX_SECURITY_SCAN_ROOT
    ? path.resolve(process.env.LATOTEX_SECURITY_SCAN_ROOT)
    : defaultRepoRoot;
  const findings = scanRepository(repoRoot);
  if (findings.length > 0) {
    console.error("[release-security-scan] high-risk findings detected:");
    for (const finding of findings) {
      console.error(`- ${finding.id}: ${finding.path}:${finding.line}`);
    }
    process.exit(1);
  }
  console.log("[release-security-scan] no high-risk local secrets, wildcard CORS patterns, or signing flow drift found.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
