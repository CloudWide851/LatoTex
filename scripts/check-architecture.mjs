import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(rootDir, "..", "src");
const featurePrefix = path.join(srcDir, "features") + path.sep;
const sharedPrefix = path.join(srcDir, "shared") + path.sep;
const appPrefix = path.join(srcDir, "app") + path.sep;
const validExtensions = new Set([".ts", ".tsx"]);

function readTrackedSourceFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (validExtensions.has(path.extname(entry.name))) {
        out.push(fullPath);
      }
    }
  };
  walk(dir);
  return out;
}

function readImports(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const matches = source.matchAll(/from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g);
  return Array.from(matches, (match) => match[1] ?? match[2]).filter(Boolean);
}

function resolveImport(filePath, specifier) {
  if (specifier.startsWith("@features/")) {
    return path.join(srcDir, "features", specifier.slice("@features/".length));
  }
  if (specifier.startsWith("@shared/")) {
    return path.join(srcDir, "shared", specifier.slice("@shared/".length));
  }
  if (specifier.startsWith("@app/")) {
    return path.join(srcDir, "app", specifier.slice("@app/".length));
  }
  if (specifier.startsWith("@/")) {
    return path.join(srcDir, specifier.slice(2));
  }
  if (specifier.startsWith(".")) {
    return path.resolve(path.dirname(filePath), specifier);
  }
  return null;
}

function normalizeResolvedTarget(target) {
  if (!target) {
    return null;
  }
  const candidates = [target, `${target}.ts`, `${target}.tsx`, path.join(target, "index.ts"), path.join(target, "index.tsx")];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? target;
}

function featureNameOf(filePath) {
  if (!filePath.startsWith(featurePrefix)) {
    return null;
  }
  const relative = filePath.slice(featurePrefix.length);
  return relative.split(path.sep)[0] || null;
}

function isFeaturePublicAlias(specifier, ownerFeature) {
  if (!specifier.startsWith("@features/")) {
    return false;
  }
  const parts = specifier.slice("@features/".length).split("/").filter(Boolean);
  if (parts.length === 0) {
    return false;
  }
  if (parts[0] === ownerFeature) {
    return true;
  }
  return parts.length === 1;
}

const errors = [];
for (const filePath of readTrackedSourceFiles(srcDir)) {
  const ownerFeature = featureNameOf(filePath);
  for (const specifier of readImports(filePath)) {
    const resolved = normalizeResolvedTarget(resolveImport(filePath, specifier));
    if (!resolved) {
      continue;
    }
    if (filePath.startsWith(sharedPrefix)) {
      if (resolved.startsWith(appPrefix) || resolved.startsWith(featurePrefix)) {
        errors.push(`${path.relative(rootDir, filePath)} -> ${specifier} crosses into app/features from shared`);
      }
      continue;
    }
    if (!ownerFeature) {
      continue;
    }
    if (resolved.startsWith(appPrefix)) {
      errors.push(`${path.relative(rootDir, filePath)} -> ${specifier} imports app internals from a feature`);
      continue;
    }
    const targetFeature = featureNameOf(resolved);
    if (targetFeature && targetFeature !== ownerFeature && !isFeaturePublicAlias(specifier, ownerFeature)) {
      errors.push(`${path.relative(rootDir, filePath)} -> ${specifier} reaches into feature '${targetFeature}' internals`);
    }
  }
}

if (errors.length > 0) {
  console.error("Architecture boundary check failed:\n");
  for (const entry of errors) {
    console.error(`- ${entry}`);
  }
  process.exit(1);
}

console.log("Architecture boundary check passed.");
