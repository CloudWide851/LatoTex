import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const targetDir = path.resolve("src-tauri/resources/tools/poppler");
const requiredTools = ["pdftotext.exe", "pdftoppm.exe", "pdfinfo.exe"];
const powershellCandidates = [
  "C:/Program Files/PowerShell/7/pwsh.exe",
  "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
  "powershell.exe",
];
const knownPopplerDirs = [
  process.env.TEXLIVE_BIN,
  "F:/TexliveData/2025/bin/windows",
  "C:/texlive/2025/bin/windows",
  "C:/texlive/2024/bin/windows",
  "D:/texlive/2025/bin/windows",
].filter(Boolean);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function existingRequiredFiles() {
  return requiredTools.filter((file) => fs.existsSync(path.join(targetDir, file)));
}

function parseExecutableList(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && fs.existsSync(line));
}

function runCommand(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
  });
}

function findWithWhere(executable) {
  try {
    const result = runCommand("where.exe", [executable]);
    if (result.status === 0) {
      return parseExecutableList(result.stdout);
    }
  } catch {
    // ignore
  }
  return [];
}

function findWithPowerShell(executable) {
  const escaped = executable.replace(/'/g, "''");
  const script = `(Get-Command '${escaped}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)`;
  for (const candidate of powershellCandidates) {
    const exists = candidate.endsWith(".exe") ? fs.existsSync(candidate) : true;
    if (!exists) {
      continue;
    }
    try {
      const result = runCommand(candidate, ["-NoProfile", "-Command", script]);
      if (result.status === 0) {
        const matches = parseExecutableList(result.stdout);
        if (matches.length > 0) {
          return matches;
        }
      }
    } catch {
      // ignore
    }
  }
  return [];
}

function findInKnownDirs(executable) {
  const candidates = [
    ...knownPopplerDirs,
    ...String(process.env.Path || process.env.PATH || "").split(";").filter(Boolean),
  ];
  const matches = [];
  for (const dir of candidates) {
    const candidate = path.join(dir, executable);
    if (fs.existsSync(candidate)) {
      matches.push(candidate);
    }
  }
  return Array.from(new Set(matches));
}

function findOnPath(executable) {
  const fromWhere = findWithWhere(executable);
  if (fromWhere.length > 0) {
    return fromWhere;
  }
  const fromPowerShell = findWithPowerShell(executable);
  if (fromPowerShell.length > 0) {
    return fromPowerShell;
  }
  return findInKnownDirs(executable);
}

function copyFileIfPresent(sourcePath, destinationPath) {
  if (!fs.existsSync(sourcePath)) {
    return false;
  }
  fs.copyFileSync(sourcePath, destinationPath);
  return true;
}

function copyFromSourceDir(sourceDir) {
  ensureDir(targetDir);
  let copiedAny = false;
  for (const file of requiredTools) {
    copiedAny = copyFileIfPresent(path.join(sourceDir, file), path.join(targetDir, file)) || copiedAny;
  }
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".dll") {
      continue;
    }
    copyFileIfPresent(path.join(sourceDir, entry.name), path.join(targetDir, entry.name));
    copiedAny = true;
  }
  return copiedAny;
}

if (process.platform !== "win32") {
  console.log("Poppler bundling skipped on non-Windows platform.");
  process.exit(0);
}

const alreadyPresent = existingRequiredFiles();
if (alreadyPresent.length === requiredTools.length) {
  console.log("Bundled Poppler tools already present.");
  process.exit(0);
}

const discovered = new Map();
for (const tool of requiredTools) {
  const matches = findOnPath(tool);
  if (matches.length > 0) {
    discovered.set(tool, matches[0]);
  }
}

if (discovered.size === 0) {
  console.warn("Poppler tools were not found on PATH. PDF OCR/layout extraction packaging remains unavailable.");
  process.exit(0);
}

const sourceDirs = Array.from(new Set(Array.from(discovered.values()).map((file) => path.dirname(file))));
let copied = false;
for (const sourceDir of sourceDirs) {
  copied = copyFromSourceDir(sourceDir) || copied;
}

const missingAfterCopy = requiredTools.filter((file) => !fs.existsSync(path.join(targetDir, file)));
if (!copied || missingAfterCopy.length > 0) {
  console.warn("Poppler tools copy did not complete. Missing:");
  for (const file of missingAfterCopy) {
    console.warn(`- ${file}`);
  }
  process.exit(0);
}

console.log(`Bundled Poppler tools copied to ${targetDir}`);
