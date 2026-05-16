import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(repoRoot, "dist", "release", "latotex-sbom.json");
const checkOnly = process.argv.includes("--check");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function packageComponents(packageJson) {
  const components = [];
  for (const [scope, deps] of [
    ["runtime", packageJson.dependencies ?? {}],
    ["development", packageJson.devDependencies ?? {}],
  ]) {
    for (const [name, version] of Object.entries(deps)) {
      components.push({
        type: "library",
        ecosystem: "npm",
        name,
        version: String(version),
        scope,
      });
    }
  }
  return components;
}

function cargoComponents() {
  const cargoLockPath = path.join(repoRoot, "src-tauri", "Cargo.lock");
  if (!fs.existsSync(cargoLockPath)) {
    return [];
  }
  const lock = fs.readFileSync(cargoLockPath, "utf8");
  const components = [];
  const blockPattern = /\[\[package\]\]\r?\n([\s\S]*?)(?=\r?\n\[\[package\]\]|\s*$)/g;
  for (const match of lock.matchAll(blockPattern)) {
    const block = match[1];
    const name = /^name = "(.+)"$/m.exec(block)?.[1];
    const version = /^version = "(.+)"$/m.exec(block)?.[1];
    if (name && version) {
      components.push({
        type: "library",
        ecosystem: "cargo",
        name,
        version,
        scope: "runtime",
      });
    }
  }
  return components;
}

const packageJson = readJson("package.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const components = [
  ...packageComponents(packageJson),
  ...cargoComponents(),
].sort((a, b) => `${a.ecosystem}:${a.name}`.localeCompare(`${b.ecosystem}:${b.name}`));

const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:uuid:latotex-${packageJson.version}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: {
      type: "application",
      name: packageJson.name,
      version: packageJson.version,
      productName: tauriConfig.productName,
      target: "x86_64-pc-windows-msvc",
      bundles: ["nsis"],
    },
  },
  components,
};

if (components.length === 0) {
  console.error("[generate-sbom] no components found.");
  process.exit(1);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(sbom, null, 2)}\n`);
console.log(`[generate-sbom] wrote ${components.length} components to ${path.relative(repoRoot, outputPath)}`);

if (checkOnly) {
  const parsed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  if (!Array.isArray(parsed.components) || parsed.components.length !== components.length) {
    console.error("[generate-sbom] generated SBOM failed readback validation.");
    process.exit(1);
  }
  console.log("[generate-sbom] SBOM readback validation passed.");
}
