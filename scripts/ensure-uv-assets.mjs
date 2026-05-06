import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const targetDir = path.resolve(projectRoot, "src-tauri/resources/tools/uv/windows-x64");
const targetExe = path.join(targetDir, "uv.exe");
const targetUvxExe = path.join(targetDir, "uvx.exe");
const manifestPath = path.resolve(projectRoot, "src-tauri/resources/tools/uv/uv-version.json");
const downloadUrl = "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip";

function fail(message) {
  console.error(`[ensure-uv-assets] ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "pipe",
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    fail(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout.trim() || result.stderr.trim();
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "User-Agent": "LatoTex-build" } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
        const nextUrl = response.headers.location;
        response.resume();
        if (!nextUrl) {
          reject(new Error("redirect response did not include a location header"));
          return;
        }
        download(new URL(nextUrl, url).toString(), destination).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`download failed with HTTP ${response.statusCode}`));
        return;
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const file = fs.createWriteStream(destination);
      response.pipe(file);
      file.on("finish", () => {
        file.close(resolve);
      });
      file.on("error", reject);
    });
    request.on("error", reject);
  });
}

function extractZip(zipPath, destination) {
  fs.mkdirSync(destination, { recursive: true });
  const powershell = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
  run(powershell, [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `Expand-Archive -LiteralPath '${zipPath.replaceAll("'", "''")}' -DestinationPath '${destination.replaceAll("'", "''")}' -Force`,
  ]);
}

function findExtractedExe(root, fileName) {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, item.name);
      if (item.isDirectory()) {
        stack.push(absolute);
      } else if (item.name.toLowerCase() === fileName) {
        return absolute;
      }
    }
  }
  return null;
}

function validateUv() {
  if (!fs.existsSync(targetExe)) {
    return null;
  }
  const result = spawnSync(targetExe, ["--version"], { encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) {
    return null;
  }
  const versionText = (result.stdout || result.stderr || "").trim();
  return versionText || null;
}

async function main() {
  const existingVersion = validateUv();
  if (existingVersion) {
    console.log(`[ensure-uv-assets] uv asset ready: ${existingVersion}`);
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "latotex-uv-"));
  const zipPath = path.join(tempDir, "uv.zip");
  const extractDir = path.join(tempDir, "extract");
  try {
    console.log(`[ensure-uv-assets] downloading ${downloadUrl}`);
    await download(downloadUrl, zipPath);
    extractZip(zipPath, extractDir);
    const uvExe = findExtractedExe(extractDir, "uv.exe");
    const uvxExe = findExtractedExe(extractDir, "uvx.exe");
    if (!uvExe) {
      fail("downloaded archive did not contain uv.exe");
    }
    fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(uvExe, targetExe);
    if (uvxExe) {
      fs.copyFileSync(uvxExe, targetUvxExe);
    }
    const versionText = validateUv();
    if (!versionText) {
      fail("downloaded uv.exe did not pass --version validation");
    }
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify({
        source: "github.com/astral-sh/uv/releases/latest",
        target: "x86_64-pc-windows-msvc",
        version: versionText,
        relativePath: "uv/windows-x64/uv.exe",
        updatedAt: new Date().toISOString(),
      }, null, 2)}\n`,
    );
    console.log(`[ensure-uv-assets] uv asset installed: ${versionText}`);
  } catch (error) {
    fail(String(error instanceof Error ? error.message : error));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

await main();
