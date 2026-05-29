#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const REPORT_ROOT = path.resolve(process.cwd(), ".latotex", "reports", "debt");
const SCAN_DIRS = ["src", "src-tauri/src"];

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function walkFiles(rootDir) {
  const absRoot = path.resolve(process.cwd(), rootDir);
  if (!fs.existsSync(absRoot)) {
    return [];
  }
  const out = [];
  const queue = [absRoot];
  while (queue.length > 0) {
    const current = queue.pop();
    const items = fs.readdirSync(current, { withFileTypes: true });
    for (const item of items) {
      if (item.name === "node_modules" || item.name === "target" || item.name === "dist") {
        continue;
      }
      const abs = path.join(current, item.name);
      if (item.isDirectory()) {
        queue.push(abs);
      } else if (item.isFile()) {
        out.push(path.relative(process.cwd(), abs).replace(/\\/g, "/"));
      }
    }
  }
  return out;
}

function listScannedFiles() {
  const files = new Set();
  for (const dir of SCAN_DIRS) {
    for (const file of walkFiles(dir)) {
      files.add(file);
    }
  }
  for (const rootFile of ["AGENTS.md", "MEMORY.md"]) {
    if (fs.existsSync(path.resolve(process.cwd(), rootFile))) {
      files.add(rootFile);
    }
  }
  return Array.from(files).sort((a, b) => a.localeCompare(b));
}

function scanMarkers(files) {
  const out = [];
  const markerPattern = /\b(TODO|FIXME|HACK|XXX|PENDING|待完成|未完成|remaining)\b/i;
  for (const file of files) {
    let content = "";
    try {
      content = fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/g);
    lines.forEach((line, idx) => {
      if (markerPattern.test(line)) {
        out.push({ file, line: idx + 1, text: line.trim().slice(0, 240) });
      }
    });
  }
  return out;
}

function scanMemoryOpenItems() {
  const candidates = ["MEMORY.md"];
  const hits = [];
  for (const file of candidates) {
    const abs = path.resolve(process.cwd(), file);
    if (!fs.existsSync(abs)) {
      continue;
    }
    const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/g);
    lines.forEach((line, idx) => {
      if (/pending|todo|待完成|未完成|remaining|still/i.test(line)) {
        hits.push({ file, line: idx + 1, text: line.trim().slice(0, 260) });
      }
    });
  }
  return hits;
}

function renderMarkdown(report) {
  const markerRows = report.markerDebts
    .map((item) => `- [${item.file}:${item.line}] ${item.text}`)
    .join("\n");
  const memoryRows = report.memoryDebts
    .map((item) => `- [${item.file}:${item.line}] ${item.text}`)
    .join("\n");

  return [
    "# Historical Debt Audit",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Scanned files: ${report.scannedFiles}`,
    `- Marker debts: ${report.markerDebts.length}`,
    `- Memory debts: ${report.memoryDebts.length}`,
    "",
    "## Marker Debts (TODO/FIXME/HACK/PENDING)",
    "",
    markerRows || "- None",
    "",
    "## Memory/Open-Item Debts",
    "",
    memoryRows || "- None",
    "",
  ].join("\n");
}

function main() {
  fs.mkdirSync(REPORT_ROOT, { recursive: true });
  const files = listScannedFiles();
  const markerDebts = scanMarkers(files);
  const memoryDebts = scanMemoryOpenItems();
  const report = {
    generatedAt: new Date().toISOString(),
    scannedFiles: files.length,
    markerDebts,
    memoryDebts,
  };
  const stamp = nowStamp();
  const jsonPath = path.join(REPORT_ROOT, `debt-audit-${stamp}.json`);
  const mdPath = path.join(REPORT_ROOT, `debt-audit-${stamp}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, `${renderMarkdown(report)}\n`, "utf8");
  process.stdout.write(`Generated debt audit:\n- ${jsonPath}\n- ${mdPath}\n`);
}

main();
