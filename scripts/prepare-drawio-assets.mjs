import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDrawioRoot = path.join(repoRoot, "src-tauri", "resources", "core", "drawio");
const allowedDownloadHosts = new Set([
  "github.com",
  "release-assets.githubusercontent.com",
]);
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export const DRAWIO_REQUIRED_VENDOR_FILES = [
  "index.html",
  "js/bootstrap.js",
  "js/main.js",
  "js/app.min.js",
  "js/extensions.min.js",
  "js/PreConfig.js",
  "js/PostConfig.js",
  "js/shapes-14-6-5.min.js",
  "js/stencils.min.js",
  "styles/grapheditor.css",
  "styles/high-contrast.css",
  "images/spin.gif",
  "images/github-logo.svg",
  "mxgraph/css/common.css",
  "mxgraph/images/maximize.gif",
  "math4/es5/startup.js",
  "resources/dia.txt",
];

function countFilesRecursive(root) {
  let count = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    const stat = fs.lstatSync(entryPath);
    if (stat.isSymbolicLink()) {
      throw new Error("DrawIO vendor contains a symbolic link");
    }
    if (entry.isDirectory()) {
      count += countFilesRecursive(entryPath);
      continue;
    }
    if (entry.isFile()) {
      count += 1;
    }
  }
  return count;
}

function loadManifest(drawioRoot) {
  const manifestPath = path.join(drawioRoot, "drawio-version.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const downloadUrl = new URL(String(manifest?.asset?.downloadUrl ?? ""));
  const size = Number(manifest?.asset?.size ?? 0);
  const sha256 = String(manifest?.asset?.sha256 ?? "").toUpperCase();
  const expectedFileCount = Number(manifest?.vendor?.expectedFileCount ?? 0);
  const excludedPaths = manifest?.vendor?.excludedPaths;

  if (downloadUrl.protocol !== "https:" || downloadUrl.hostname !== "github.com") {
    throw new Error("DrawIO asset URL must use the pinned GitHub HTTPS host");
  }
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error("DrawIO asset size is invalid");
  }
  if (!/^[A-F0-9]{64}$/.test(sha256)) {
    throw new Error("DrawIO asset SHA-256 is invalid");
  }
  if (!Number.isSafeInteger(expectedFileCount) || expectedFileCount <= 0) {
    throw new Error("DrawIO vendor file count is invalid");
  }
  if (!Array.isArray(excludedPaths) || excludedPaths.length !== 1 || excludedPaths[0] !== "WEB-INF/classes") {
    throw new Error("DrawIO archive exclusion policy is invalid");
  }

  return {
    downloadUrl,
    size,
    sha256,
    expectedFileCount,
    excludedPaths,
    tag: String(manifest?.source?.tag ?? ""),
  };
}

export function verifyDrawioVendor(drawioRoot = defaultDrawioRoot) {
  if (!fs.statSync(path.join(drawioRoot, "index.html"), { throwIfNoEntry: false })?.isFile()) {
    throw new Error("DrawIO host entry is missing");
  }
  const manifest = loadManifest(drawioRoot);
  const vendorRoot = path.join(drawioRoot, "vendor");
  if (!fs.statSync(vendorRoot, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error("DrawIO vendor directory is missing");
  }
  if (fs.existsSync(path.join(vendorRoot, "WEB-INF", "classes"))) {
    throw new Error("DrawIO vendor contains excluded server classes");
  }

  const missing = DRAWIO_REQUIRED_VENDOR_FILES.filter(
    (relativePath) => !fs.statSync(path.join(vendorRoot, relativePath), { throwIfNoEntry: false })?.isFile(),
  );
  if (missing.length > 0) {
    throw new Error(`DrawIO vendor is incomplete: ${missing.join(", ")}`);
  }

  const actualFileCount = countFilesRecursive(vendorRoot);
  if (actualFileCount !== manifest.expectedFileCount) {
    throw new Error(
      `DrawIO vendor file count mismatch: expected ${manifest.expectedFileCount}, found ${actualFileCount}`,
    );
  }
  return { fileCount: actualFileCount, tag: manifest.tag };
}

function assertAllowedDownloadUrl(url) {
  if (url.protocol !== "https:" || !allowedDownloadHosts.has(url.hostname)) {
    throw new Error("DrawIO download redirect host is not allowed");
  }
}

async function openPinnedResponse(initialUrl) {
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    assertAllowedDownloadUrl(currentUrl);
    const response = await fetch(currentUrl, {
      headers: {
        Accept: "application/octet-stream",
        "User-Agent": "LatoTex-Release-Resource-Prep",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(120_000),
    });
    if (redirectStatuses.has(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("DrawIO download redirect is missing a location");
      }
      currentUrl = new URL(location, currentUrl);
      continue;
    }
    if (!response.ok || !response.body) {
      throw new Error(`DrawIO download failed with HTTP ${response.status} from ${currentUrl.hostname}`);
    }
    return response;
  }
  throw new Error("DrawIO download exceeded the redirect limit");
}

async function downloadPinnedAsset(manifest, destination) {
  const response = await openPinnedResponse(manifest.downloadUrl);
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > 0 && declaredLength !== manifest.size) {
    throw new Error("DrawIO download size header does not match the manifest");
  }

  const hash = crypto.createHash("sha256");
  const handle = fs.openSync(destination, "wx");
  let written = 0;
  try {
    for await (const rawChunk of response.body) {
      const chunk = Buffer.from(rawChunk);
      written += chunk.length;
      if (written > manifest.size) {
        throw new Error("DrawIO download exceeded the pinned size");
      }
      hash.update(chunk);
      fs.writeSync(handle, chunk);
    }
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }

  const digest = hash.digest("hex").toUpperCase();
  if (written !== manifest.size || digest !== manifest.sha256) {
    throw new Error("DrawIO download integrity verification failed");
  }
}

export function drawioArchiveExtractionCommand(platform, archivePath, destination) {
  if (platform === "win32") {
    return {
      command: "tar",
      args: [
        "-xf",
        archivePath,
        "-C",
        destination,
        "--exclude=WEB-INF/classes",
        "--exclude=WEB-INF/classes/*",
      ],
    };
  }
  return {
    command: "unzip",
    args: [
      "-q",
      archivePath,
      "-x",
      "WEB-INF/classes/*",
      "-d",
      destination,
    ],
  };
}

function extractArchive(archivePath, destination) {
  fs.mkdirSync(destination, { recursive: true });
  const extractor = drawioArchiveExtractionCommand(process.platform, archivePath, destination);
  const result = spawnSync(extractor.command, extractor.args, {
    encoding: "utf8",
    shell: false,
    timeout: 120_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const reason = result.error?.code ?? `exit ${String(result.status)}`;
    throw new Error(`DrawIO archive extraction failed with ${extractor.command} (${reason})`);
  }
}

function replaceVendor(drawioRoot, stagedVendor) {
  const vendorRoot = path.join(drawioRoot, "vendor");
  const backupRoot = path.join(drawioRoot, `.vendor-backup-${process.pid}-${crypto.randomUUID()}`);
  const hadVendor = fs.existsSync(vendorRoot);
  if (hadVendor) {
    fs.renameSync(vendorRoot, backupRoot);
  }
  try {
    fs.renameSync(stagedVendor, vendorRoot);
  } catch (error) {
    if (hadVendor && !fs.existsSync(vendorRoot) && fs.existsSync(backupRoot)) {
      fs.renameSync(backupRoot, vendorRoot);
    }
    throw error;
  }
  if (hadVendor) {
    fs.rmSync(backupRoot, { recursive: true, force: true });
  }
}

export async function prepareDrawioAssets(drawioRoot = defaultDrawioRoot) {
  try {
    const ready = verifyDrawioVendor(drawioRoot);
    console.log(`[prepare-drawio] pinned DrawIO ${ready.fileCount}-file vendor already ready.`);
    return ready;
  } catch (error) {
    console.log(`[prepare-drawio] restoring pinned vendor (${String(error?.message ?? "verification failed")}).`);
  }

  const manifest = loadManifest(drawioRoot);
  // Keep extraction near the repository root. Deep Windows workspace paths plus
  // DrawIO's own long names can otherwise exceed the legacy path limit in tar.
  const tempRoot = fs.mkdtempSync(path.join(repoRoot, ".drawio-prepare-"));
  const archivePath = path.join(tempRoot, "drawio.war");
  const stagedVendor = path.join(tempRoot, "vendor");
  try {
    await downloadPinnedAsset(manifest, archivePath);
    extractArchive(archivePath, stagedVendor);
    for (const relativePath of manifest.excludedPaths) {
      const excludedPath = path.join(stagedVendor, relativePath);
      fs.rmSync(excludedPath, { recursive: true, force: true });
      if (fs.existsSync(excludedPath)) {
        throw new Error("DrawIO archive exclusion failed");
      }
    }

    const stagedRoot = path.join(tempRoot, "contract");
    fs.mkdirSync(stagedRoot, { recursive: true });
    fs.copyFileSync(path.join(drawioRoot, "index.html"), path.join(stagedRoot, "index.html"));
    fs.copyFileSync(path.join(drawioRoot, "drawio-version.json"), path.join(stagedRoot, "drawio-version.json"));
    fs.renameSync(stagedVendor, path.join(stagedRoot, "vendor"));
    const ready = verifyDrawioVendor(stagedRoot);
    replaceVendor(drawioRoot, path.join(stagedRoot, "vendor"));
    console.log(`[prepare-drawio] pinned DrawIO ${ready.fileCount}-file vendor restored and verified.`);
    return ready;
  } finally {
    try {
      fs.rmSync(tempRoot, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 250,
      });
    } catch {
      console.warn("[prepare-drawio] temporary cleanup was deferred; the ignored staging directory can be removed safely.");
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareDrawioAssets().catch((error) => {
    console.error(`[prepare-drawio] failed: ${String(error?.message ?? error)}`);
    process.exit(1);
  });
}
