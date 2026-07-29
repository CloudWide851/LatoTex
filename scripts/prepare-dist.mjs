import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(repoRoot, "dist");
const relativeDist = path.relative(repoRoot, distDir);

if (relativeDist !== "dist" || path.dirname(distDir) !== repoRoot) {
  throw new Error(`Refusing to clean unexpected build output path: ${distDir}`);
}

await fs.rm(distDir, {
  recursive: true,
  force: true,
  maxRetries: 8,
  retryDelay: 200,
});

console.log(`Prepared clean build output at ${distDir}`);
