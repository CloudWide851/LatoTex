import fs from "node:fs";
import path from "node:path";

const BARE_IMPORT_RE = /((?:import|export)\s+(?:[^"'()`]*?\s+from\s+)?|import\s*\()\s*["']([^"']+)["']/g;
const SKIPPED_BROWSER_VENDOR_EXACT = new Set([
  "lib0/isomorphic.js",
  "pdf.min.mjs",
  "pdf.worker.min.mjs",
]);

export function shouldSkipBrowserVendorFile(fileName) {
  return (
    fileName === "isomorphic.js"
    || fileName.endsWith(".test.js")
    || fileName.endsWith(".node.js")
    || fileName.endsWith(".react-native.js")
    || fileName.endsWith(".deno.js")
  );
}

export function shouldSkipBrowserVendorPath(relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  return (
    SKIPPED_BROWSER_VENDOR_EXACT.has(normalized)
    || normalized.startsWith("lib0/bin/")
    || normalized.includes("/bin/")
  );
}

function normalizeJsSpecifier(specifier) {
  const normalized = String(specifier || "").replace(/\\/g, "/").replace(/\.js$/i, "");
  return `${normalized}.js`;
}

function toRelativeSpecifier(fromFile, toFile) {
  const relative = path.posix.relative(path.posix.dirname(fromFile), toFile);
  return relative.startsWith(".") ? relative : `./${relative}`;
}

export function rewriteShareVendorImports(source, fileRelativePath) {
  const normalizedFile = String(fileRelativePath || "").replace(/\\/g, "/");
  return source.replace(BARE_IMPORT_RE, (match, prefix, specifier) => {
    if (!specifier.startsWith("lib0/")) {
      return match;
    }
    const target = normalizeJsSpecifier(specifier);
    const nextSpecifier = toRelativeSpecifier(normalizedFile, target);
    return `${prefix}"${nextSpecifier}"`;
  });
}

export function listInvalidBrowserImportSpecifiers(source) {
  const invalid = [];
  for (const match of source.matchAll(BARE_IMPORT_RE)) {
    const specifier = String(match[2] || "");
    if (
      specifier.startsWith(".")
      || specifier.startsWith("/")
      || specifier.startsWith("data:")
      || specifier.startsWith("http:")
      || specifier.startsWith("https:")
    ) {
      continue;
    }
    invalid.push(specifier);
  }
  return invalid;
}

export function validateBrowserVendorTree(rootDir) {
  const invalid = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(rootDir, absolute).replace(/\\/g, "/");
      if (shouldSkipBrowserVendorPath(relative)) {
        continue;
      }
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!/\.(?:js|mjs)$/i.test(entry.name) || shouldSkipBrowserVendorFile(entry.name)) {
        continue;
      }
      const source = fs.readFileSync(absolute, "utf8");
      const specifiers = listInvalidBrowserImportSpecifiers(source);
      if (specifiers.length > 0) {
        invalid.push({
          file: absolute,
          specifiers,
        });
      }
    }
  };
  walk(rootDir);
  return invalid;
}
