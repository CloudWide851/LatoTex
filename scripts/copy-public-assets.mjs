import fs from "node:fs/promises";
import path from "node:path";

const sourceDir = path.resolve("public");
const targetDir = path.resolve("dist");
const RETRYABLE_CODES = new Set(["EBUSY", "EPERM", "EMFILE"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function copyFileWithRetry(sourcePath, targetPath) {
  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
      return;
    } catch (error) {
      if (
        attempt === maxAttempts
        || !(error instanceof Error)
        || !("code" in error)
        || !RETRYABLE_CODES.has(String(error.code))
      ) {
        throw error;
      }
      await sleep(attempt * 200);
    }
  }
}

async function copyDirectory(sourcePath, targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
  const entries = await fs.readdir(sourcePath, { withFileTypes: true });
  for (const entry of entries) {
    const nextSourcePath = path.join(sourcePath, entry.name);
    const nextTargetPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(nextSourcePath, nextTargetPath);
      continue;
    }
    await copyFileWithRetry(nextSourcePath, nextTargetPath);
  }
}

await copyDirectory(sourceDir, targetDir);
console.log(`Public assets copied to ${targetDir}`);
