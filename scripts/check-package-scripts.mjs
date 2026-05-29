import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const scriptEntries = Object.entries(packageJson.scripts ?? {});
const errors = [];

for (const [name, command] of scriptEntries) {
  const nodeScriptRefs = command.matchAll(/\bnode\s+(scripts\/[^\s&|]+\.mjs)\b/g);
  for (const match of nodeScriptRefs) {
    const scriptPath = match[1];
    if (!fs.existsSync(path.join(repoRoot, scriptPath))) {
      errors.push(`${name} references missing ${scriptPath}`);
    }
  }
  if (/sign(?:ed|ing|ature)?/i.test(name) || /sign-win-x64|--require-signing|LATOTEX_SIGN/i.test(command)) {
    errors.push(`${name} reintroduces Windows signing flow`);
  }
}

for (const workflowName of [".github/workflows/ci.yml", ".github/workflows/release-tauri.yml"]) {
  const workflowPath = path.join(repoRoot, workflowName);
  if (!fs.existsSync(workflowPath)) {
    continue;
  }
  const workflow = fs.readFileSync(workflowPath, "utf8");
  if (/release:package:win-x64:signed|--require-signing|LATOTEX_SIGN|signtool/i.test(workflow)) {
    errors.push(`${workflowName} reintroduces Windows signing flow`);
  }
}

if (errors.length > 0) {
  console.error("Package script check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Package script check passed.");
