import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const sourceRoots = [
  path.join(repoRoot, "src", "app", "components"),
  path.join(repoRoot, "src", "components", "ui"),
  path.join(repoRoot, "src", "share-page"),
];

const contentSurfacePatterns = [
  /\/components\/(?:docx|markdown|pdf|terminal)\//,
  /\/components\/(?:CodePreviewPane|TablePreviewPane|LibraryDocumentViewer)\.tsx$/,
  /\/components\/editor\/WorkspaceMonacoEditor\.tsx$/,
  /\/components\/git\/GitDiffViewer\.tsx$/,
  /\/components\/knowledge\/KnowledgeGraphCanvas\.tsx$/,
  /\/components\/library\/(?:LibraryPdf|PdfAnnotation|PdfTextBox)[^/]*\.tsx$/,
];

function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/");
}

export function isCompactChromeContentSurface(filePath) {
  const normalized = normalizePath(filePath);
  return contentSurfacePatterns.some((pattern) => pattern.test(normalized));
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function pushMatch(violations, source, match, rule, detail) {
  violations.push({
    rule,
    line: lineNumberAt(source, match.index ?? 0),
    detail,
  });
}

export function findCompactChromeViolations(source, filePath = "fixture.tsx") {
  if (isCompactChromeContentSurface(filePath)) {
    return [];
  }

  const violations = [];
  for (const match of source.matchAll(/\btext-(?:lg|xl|(?:[2-9]|1\d)xl)\b/g)) {
    pushMatch(violations, source, match, "large-type", match[0]);
  }
  for (const match of source.matchAll(/\btext-\[(\d+(?:\.\d+)?)px\]/g)) {
    if (Number(match[1]) >= 17) {
      pushMatch(violations, source, match, "large-type", match[0]);
    }
  }
  for (const match of source.matchAll(/>\s*\{\s*((?:t|props\.t)\(\s*["'][^"']*(?:\.subtitle|Subtitle)["']\s*\))\s*\}\s*</g)) {
    pushMatch(violations, source, match, "visible-subtitle", match[1]);
  }
  for (const match of source.matchAll(/>\s*\{\s*(this\.state\.errorMessage)\s*\}\s*</g)) {
    pushMatch(violations, source, match, "raw-error", match[1]);
  }
  return violations;
}

function collectTsxFiles(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".tsx") && !entry.name.includes(".spec.")) {
        files.push(fullPath);
      }
    }
  };
  walk(root);
  return files;
}

export function scanCompactChrome() {
  const violations = [];
  for (const root of sourceRoots) {
    for (const filePath of collectTsxFiles(root)) {
      const relativePath = normalizePath(path.relative(repoRoot, filePath));
      const source = fs.readFileSync(filePath, "utf8");
      for (const violation of findCompactChromeViolations(source, relativePath)) {
        violations.push({ ...violation, filePath: relativePath });
      }
    }
  }
  return violations;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const violations = scanCompactChrome();
  if (violations.length > 0) {
    console.error("Compact chrome check failed:\n");
    for (const violation of violations) {
      console.error(`- ${violation.filePath}:${violation.line} [${violation.rule}] ${violation.detail}`);
    }
    process.exit(1);
  }
  console.log("Compact chrome check passed.");
}
