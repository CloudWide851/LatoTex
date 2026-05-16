import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const limit = 600;
const sourceRoots = ["src", "src-tauri/src"].map((entry) => path.join(repoRoot, entry));
const extensions = new Set([".rs", ".ts", ".tsx"]);

const legacyExemptions = new Set([
  "src/app/components/AppWorkspaceShell.tsx",
  "src/app/components/ExplorerTree.spec.tsx",
  "src/app/hooks/useAppContainerWorkspaceActions.ts",
  "src-tauri/src/commands/native_runtime_analysis_env.rs",
  "src-tauri/src/models.rs",
  "src-tauri/src/storage/library_translation/paper_translation_engine.rs",
  "src-tauri/src/storage/workspace_files_search.rs",
]);

function toRepoPath(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "target" || entry.name === "node_modules") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, out);
      continue;
    }
    if (extensions.has(path.extname(entry.name))) {
      out.push(fullPath);
    }
  }
  return out;
}

const violations = [];
const legacyViolations = [];

for (const root of sourceRoots) {
  for (const filePath of walk(root)) {
    const repoPath = toRepoPath(filePath);
    const lineCount = fs.readFileSync(filePath, "utf8").split(/\r?\n/).length;
    if (lineCount <= limit) {
      continue;
    }
    const entry = `${repoPath} (${lineCount} lines)`;
    if (legacyExemptions.has(repoPath)) {
      legacyViolations.push(entry);
    } else {
      violations.push(entry);
    }
  }
}

if (violations.length > 0) {
  console.error(`Source file size check failed. New files must stay at or below ${limit} lines:`);
  for (const entry of violations) {
    console.error(`- ${entry}`);
  }
  process.exit(1);
}

if (legacyViolations.length > 0) {
  console.log(`Source file size check passed with ${legacyViolations.length} documented legacy exemptions:`);
  for (const entry of legacyViolations) {
    console.log(`- ${entry}`);
  }
} else {
  console.log(`Source file size check passed. All source files are at or below ${limit} lines.`);
}
