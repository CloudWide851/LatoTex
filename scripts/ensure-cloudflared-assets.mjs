import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const manifestPath = path.resolve("src-tauri/resources/tools/cloudflared-version.json");

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex").toUpperCase();
}

if (!fs.existsSync(manifestPath)) {
  console.error("Bundled cloudflared manifest is missing.");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const relativePath = String(manifest?.file ?? "").trim();
const expectedSha256 = String(manifest?.sha256 ?? "").trim().toUpperCase();
const expectedSize = Number(manifest?.size ?? Number.NaN);

if (!relativePath || !expectedSha256 || !Number.isFinite(expectedSize) || expectedSize <= 0) {
  console.error("Bundled cloudflared manifest is invalid.");
  process.exit(1);
}

const binaryPath = path.resolve("src-tauri/resources/tools", relativePath);
if (!fs.existsSync(binaryPath)) {
  console.error(
    [
      "Bundled cloudflared binary is missing.",
      `- expected: ${binaryPath}`,
    ].join("\n"),
  );
  process.exit(1);
}

const actualSize = fs.statSync(binaryPath).size;
if (actualSize !== expectedSize) {
  console.error(
    [
      "Bundled cloudflared binary size mismatch.",
      `- expected: ${expectedSize}`,
      `- actual: ${actualSize}`,
    ].join("\n"),
  );
  process.exit(1);
}

const actualSha256 = sha256(binaryPath);
if (actualSha256 !== expectedSha256) {
  console.error(
    [
      "Bundled cloudflared binary hash mismatch.",
      `- expected: ${expectedSha256}`,
      `- actual: ${actualSha256}`,
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`Bundled cloudflared ready (${manifest.version ?? "unknown"})`);
