import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const REQUIRED_BUNDLED_RESOURCE_FILES = [
  "core/drawio/index.html",
  "core/drawio/drawio-version.json",
  "core/drawio/vendor/index.html",
  "core/drawio/vendor/js/app.min.js",
  "core/share-page/index.html",
  "core/skills/catalog.json",
  "core/skills/literature-search/SKILL.md",
  "core/skills/systematic-review/SKILL.md",
  "core/skills/statistical-analysis/SKILL.md",
  "core/skills/research-reproducibility/SKILL.md",
  "python/analysis_runtime/analysis_runner.py",
  "tools/cloudflared-version.json",
  "tools/cloudflared-windows-amd64.exe",
  "tools/tectonic/bundles/tlextras-2022.0r0.tar",
  "tools/tectonic/windows-x64/tectonic.exe",
  "tools/uv/uv-version.json",
  "tools/uv/windows-x64/uv.exe",
];

export const REQUIRED_BUNDLED_RESOURCE_DIRECTORIES = [
  "tools/tectonic/cache-seed/files",
  "tools/tectonic/cache-seed/indexes",
  "tools/tectonic/cache-seed/manifests",
];

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  const handle = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest("hex").toUpperCase();
}

function parseJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function runVersion(executable, args, expected, label) {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    shell: false,
    timeout: 15000,
    windowsHide: true,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (result.error || result.status !== 0 || !output.includes(expected)) {
    const detail = result.error?.message ?? `exit=${String(result.status)}`;
    throw new Error(`${label} version verification failed (${detail})`);
  }
  return output.split(/\r?\n/, 1)[0];
}

export function verifyBundledResourceContract(resourcesRoot, options = {}) {
  const label = options.label ?? "bundled resources";
  const missingFiles = REQUIRED_BUNDLED_RESOURCE_FILES.filter(
    (relativePath) => !fs.statSync(path.join(resourcesRoot, relativePath), { throwIfNoEntry: false })?.isFile(),
  );
  const missingDirectories = REQUIRED_BUNDLED_RESOURCE_DIRECTORIES.filter(
    (relativePath) => !fs.statSync(path.join(resourcesRoot, relativePath), { throwIfNoEntry: false })?.isDirectory(),
  );
  if (missingFiles.length > 0 || missingDirectories.length > 0) {
    const missing = [...missingFiles, ...missingDirectories].join(", ");
    throw new Error(`${label} incomplete: ${missing}`);
  }

  const drawioMetadata = parseJson(path.join(resourcesRoot, "core/drawio/drawio-version.json"));
  if (drawioMetadata.source?.tag !== "v29.6.6"
    || drawioMetadata.vendor?.expectedFileCount !== 3337
    || drawioMetadata.asset?.size !== 52104150
    || !/^[A-F0-9]{64}$/.test(String(drawioMetadata.asset?.sha256 ?? ""))) {
    throw new Error(`${label} DrawIO metadata mismatch`);
  }
  if (fs.existsSync(path.join(resourcesRoot, "core/drawio/vendor/WEB-INF/classes"))) {
    throw new Error(`${label} DrawIO server classes must not be bundled`);
  }

  const cloudflaredMetadata = parseJson(path.join(resourcesRoot, "tools/cloudflared-version.json"));
  const cloudflaredPath = path.join(resourcesRoot, "tools", cloudflaredMetadata.file);
  const cloudflaredStat = fs.statSync(cloudflaredPath);
  if (cloudflaredMetadata.file !== "cloudflared-windows-amd64.exe"
    || cloudflaredMetadata.size !== cloudflaredStat.size
    || String(cloudflaredMetadata.sha256).toUpperCase() !== sha256(cloudflaredPath)) {
    throw new Error(`${label} cloudflared integrity mismatch`);
  }

  const uvMetadata = parseJson(path.join(resourcesRoot, "tools/uv/uv-version.json"));
  if (uvMetadata.relativePath !== "uv/windows-x64/uv.exe"
    || typeof uvMetadata.version !== "string"
    || !uvMetadata.version.startsWith("uv ")) {
    throw new Error(`${label} uv metadata mismatch`);
  }

  const versions = {};
  if (options.verifyExecutables) {
    versions.uv = runVersion(
      path.join(resourcesRoot, "tools", uvMetadata.relativePath),
      ["--version"],
      uvMetadata.version,
      "bundled uv",
    );
  }
  return { versions };
}
