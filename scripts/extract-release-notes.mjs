import fs from "node:fs";

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

const version = readArg("--version").trim().replace(/^v/, "");
const output = readArg("--output").trim();
if (!/^\d+\.\d+\.\d+$/.test(version) || !output) {
  throw new Error("usage: --version <semver> --output <path>");
}

const changelog = fs.readFileSync("CHANGELOG.md", "utf8");
const lines = changelog.split(/\r?\n/);
const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
const end = lines.findIndex((line, index) => index > start && line.startsWith("## ["));
const notes = start >= 0 ? lines.slice(start + 1, end >= 0 ? end : lines.length).join("\n").trim() : "";
if (!notes) {
  throw new Error(`CHANGELOG section not found for ${version}`);
}
fs.writeFileSync(output, `${notes}\n`, "utf8");
