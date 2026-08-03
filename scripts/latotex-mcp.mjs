import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const serverVersion = "0.1.4";
const textExtensions = new Set([".tex", ".bib", ".sty", ".cls"]);
const writeExtensions = new Set([".tex", ".bib", ".sty", ".cls"]);
const ignoredDirs = new Set([".git", "node_modules", "target", "dist"]);
const textFileLimit = 16 * 1024 * 1024;
const resultLimit = 64 * 1024;
const maxWalkEntries = 50_000;

function normalizeRoot(root) {
  const resolved = fs.realpathSync(path.resolve(root || process.cwd()));
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error("project_root_invalid");
  }
  return resolved;
}

function repoPath(root, fullPath) {
  return path.relative(root, fullPath).replaceAll(path.sep, "/");
}

function isWithinRoot(root, candidate) {
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return candidate === root || candidate.startsWith(rootWithSep);
}

function rejectLinkAncestors(root, candidate, includeTarget) {
  const relative = path.relative(root, candidate);
  let current = root;
  const parts = relative.split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    if (!includeTarget && index === parts.length - 1) break;
    if (!fs.existsSync(current)) continue;
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error("path_link_denied");
    }
  }
}

function resolveProjectPath(root, relativePath, allowedExtensions = textExtensions, forWrite = false) {
  const clean = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.includes("\0") || path.isAbsolute(clean)) {
    throw new Error("invalid_relative_path");
  }
  const resolved = path.resolve(root, clean);
  if (!isWithinRoot(root, resolved)) {
    throw new Error("path_outside_project");
  }
  const ext = path.extname(resolved).toLowerCase();
  if (allowedExtensions && !allowedExtensions.has(ext)) {
    throw new Error(`unsupported_extension:${ext || "none"}`);
  }
  rejectLinkAncestors(root, resolved, true);
  if (fs.existsSync(resolved)) {
    const canonical = fs.realpathSync(resolved);
    if (!isWithinRoot(root, canonical) || fs.lstatSync(resolved).isSymbolicLink()) {
      throw new Error("path_link_denied");
    }
    return canonical;
  }
  if (!forWrite) {
    throw new Error("path_missing");
  }
  rejectLinkAncestors(root, path.dirname(resolved), true);
  return resolved;
}

function walkFiles(root, current = root, out = [], state = { entries: 0 }) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    state.entries += 1;
    if (state.entries > maxWalkEntries) throw new Error("project_too_many_entries");
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        walkFiles(root, path.join(current, entry.name), out, state);
      }
      continue;
    }
    const fullPath = path.join(current, entry.name);
    if (textExtensions.has(path.extname(entry.name).toLowerCase())) {
      out.push(fullPath);
    }
  }
  return out;
}

function walkProjectFiles(root, current = root, out = [], state = { entries: 0 }) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    state.entries += 1;
    if (state.entries > maxWalkEntries) throw new Error("project_too_many_entries");
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        walkProjectFiles(root, path.join(current, entry.name), out, state);
      }
      continue;
    }
    out.push(path.join(current, entry.name));
  }
  return out;
}

function readTextBounded(target) {
  const stat = fs.statSync(target);
  if (!stat.isFile()) throw new Error("file_required");
  if (stat.size > textFileLimit) throw new Error("file_too_large");
  const bytes = fs.readFileSync(target);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("invalid_utf8");
  }
}

function atomicWriteText(root, target, content) {
  if (Buffer.byteLength(content, "utf8") > textFileLimit) throw new Error("file_too_large");
  rejectLinkAncestors(root, target, true);
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  const handle = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeFileSync(handle, content, "utf8");
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  try {
    fs.renameSync(temp, target);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

function sanitizeText(value, limit = 2048) {
  return String(value ?? "")
    .replace(/[\r\n\t\u0000-\u001f\u007f]+/g, " ")
    .replace(/(bearer\s+|api[_-]?key\s*[:=]\s*|password\s*[:=]\s*|secret\s*[:=]\s*|token\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/https?:\/\/[^\s?#]+[?#][^\s]*/gi, (url) => url.split(/[?#]/, 1)[0])
    .slice(0, limit);
}

function boundedResult(value) {
  const payload = JSON.stringify(value);
  if (Buffer.byteLength(payload, "utf8") > resultLimit) throw new Error("result_too_large");
  return value;
}

function parseBibEntries(content, sourcePath) {
  const entries = [];
  const entryRe = /@(\w+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)(?=\n@\w+\s*\{|$)/g;
  for (const match of content.matchAll(entryRe)) {
    const body = match[3] || "";
    const field = (name) => {
      const found = body.match(new RegExp(`${name}\\s*=\\s*[{"']?([^}"'\\n]+)`, "i"));
      return found?.[1]?.trim() ?? "";
    };
    entries.push({
      citationKey: match[2].trim(),
      entryType: match[1].trim(),
      title: field("title"),
      author: field("author"),
      year: field("year"),
      doi: field("doi"),
      arxiv: field("arxiv") || field("eprint"),
      url: field("url"),
      sourcePath,
    });
  }
  return entries;
}

export function searchPapers(projectRoot, query = "", limit = 10) {
  const root = normalizeRoot(projectRoot);
  const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  const entries = [];
  for (const filePath of walkFiles(root).filter((item) => item.toLowerCase().endsWith(".bib"))) {
    const sourcePath = repoPath(root, filePath);
    entries.push(...parseBibEntries(readTextBounded(filePath), sourcePath));
  }
  return entries
    .map((entry) => {
      const haystack = [
        entry.citationKey,
        entry.title,
        entry.author,
        entry.year,
        entry.sourcePath,
      ].join(" ").toLowerCase();
      const score = terms.length === 0
        ? 1
        : terms.reduce((acc, term) => acc + (haystack.includes(term) ? 1 : 0), 0);
      return { ...entry, score };
    })
    .filter((entry) => terms.length === 0 || entry.score > 0)
    .sort((a, b) => b.score - a.score || a.citationKey.localeCompare(b.citationKey))
    .slice(0, Math.max(1, Math.min(50, Number(limit) || 10)));
}

function collectValues(source, regex) {
  const values = [];
  for (const match of source.matchAll(regex)) {
    const value = String(match[1] || "").trim();
    if (value) {
      values.push(value);
    }
  }
  return Array.from(new Set(values));
}

function readBibKeys(root) {
  return new Set(searchPapers(root, "", 500).map((entry) => entry.citationKey));
}

function extractCitationOccurrences(source) {
  const values = [];
  for (const match of source.matchAll(/\\cite[a-zA-Z*]*\s*(?:\[[^\]]*])*\s*\{([^}]+)\}/g)) {
    values.push(
      ...String(match[1] || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
  }
  return values;
}

function evidenceForEntry(entry) {
  const evidence = ["library"];
  if (entry.doi) evidence.push("doi");
  if (entry.arxiv) evidence.push("arxiv");
  if (entry.title) evidence.push("title");
  if (entry.url) evidence.push("url");
  if (entry.author && entry.year) evidence.push("author-year");
  return evidence;
}

export function auditCitations(projectRoot, mainPath) {
  const root = normalizeRoot(projectRoot);
  const texFiles = walkFiles(root).filter((item) => item.toLowerCase().endsWith(".tex"));
  const target = mainPath ? resolveProjectPath(root, mainPath, new Set([".tex"])) : texFiles[0];
  if (!target) {
    throw new Error("no_tex_file");
  }
  const source = readTextBounded(target);
  const entries = searchPapers(root, "", 1000);
  const entryByKey = new Map(entries.map((entry) => [entry.citationKey, entry]));
  const occurrences = extractCitationOccurrences(source);
  const citationKeys = Array.from(new Set(occurrences));
  const duplicateKeys = Array.from(new Set(occurrences.filter((key, index) => occurrences.indexOf(key) !== index)));
  const citations = citationKeys.map((key) => {
    const entry = entryByKey.get(key);
    if (!entry) {
      return { key, status: "fail", evidence: [], issue: "missing_bib_entry" };
    }
    const evidence = evidenceForEntry(entry);
    const strong = evidence.some((item) => item !== "library");
    return {
      key,
      status: strong ? "pass" : "warn",
      evidence,
      sourcePath: entry.sourcePath,
      issue: strong ? "" : "weak_metadata",
    };
  });
  const issues = [];
  const missingKeys = citations.filter((item) => item.status === "fail").map((item) => item.key);
  const weakKeys = citations.filter((item) => item.status === "warn").map((item) => item.key);
  if (citationKeys.length === 0) {
    issues.push({ id: "noCitations", severity: "warning" });
  }
  if (missingKeys.length > 0) {
    issues.push({ id: "missingCitationKeys", severity: "error", detail: missingKeys });
  }
  if (weakKeys.length > 0) {
    issues.push({ id: "weakCitationMetadata", severity: "warning", detail: weakKeys });
  }
  if (duplicateKeys.length > 0) {
    issues.push({ id: "duplicateCitationUse", severity: "warning", detail: duplicateKeys });
  }
  const status = issues.some((item) => item.severity === "error")
    ? "fail"
    : issues.length > 0
      ? "warn"
      : "pass";
  return {
    mainPath: repoPath(root, target),
    status,
    summary: {
      total: citations.length,
      pass: citations.filter((item) => item.status === "pass").length,
      warn: citations.filter((item) => item.status === "warn").length,
      fail: citations.filter((item) => item.status === "fail").length,
    },
    issues,
    citations,
  };
}

export function checkSubmission(projectRoot, mainPath) {
  const root = normalizeRoot(projectRoot);
  const texFiles = walkFiles(root).filter((item) => item.toLowerCase().endsWith(".tex"));
  const target = mainPath ? resolveProjectPath(root, mainPath, new Set([".tex"])) : texFiles[0];
  if (!target) {
    throw new Error("no_tex_file");
  }
  const source = readTextBounded(target);
  const files = new Set(walkProjectFiles(root).map((item) => repoPath(root, item).toLowerCase()));
  const labels = collectValues(source, /\\label\{([^}]+)\}/g);
  const refs = collectValues(source, /\\(?:eq)?ref\{([^}]+)\}/g);
  const cites = collectValues(source, /\\cite[a-zA-Z*]*\s*(?:\[[^\]]*])*\s*\{([^}]+)\}/g)
    .flatMap((value) => value.split(",").map((item) => item.trim()).filter(Boolean));
  const bibKeys = readBibKeys(root);
  const issues = [];
  if (!/\\begin\{document\}/.test(source) || !/\\end\{document\}/.test(source)) {
    issues.push({ id: "missingDocumentEnvironment", severity: "error" });
  }
  const missingRefs = refs.filter((item) => !labels.includes(item));
  if (missingRefs.length > 0) {
    issues.push({ id: "undefinedReferences", severity: "warning", detail: missingRefs });
  }
  const missingCites = cites.filter((item) => !bibKeys.has(item));
  if (missingCites.length > 0) {
    issues.push({ id: "missingBibliography", severity: "warning", detail: missingCites });
  }
  const figures = collectValues(source, /\\includegraphics(?:\[[^\]]*])?\{([^}]+)\}/g);
  const missingFigures = figures.filter((figure) => {
    const normalized = figure.replace(/\\/g, "/").toLowerCase();
    return !files.has(normalized) && ![".pdf", ".png", ".jpg", ".jpeg"].some((ext) => files.has(`${normalized}${ext}`));
  });
  if (missingFigures.length > 0) {
    issues.push({ id: "missingFigures", severity: "warning", detail: missingFigures });
  }
  if (issues.length === 0) {
    issues.push({ id: "ready", severity: "info" });
  }
  return { mainPath: repoPath(root, target), issues };
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 10_000 });
  return !result.error && result.status === 0;
}

export function compileTex(projectRoot, mainPath) {
  const root = normalizeRoot(projectRoot);
  const target = resolveProjectPath(root, mainPath, new Set([".tex"]));
  const relative = repoPath(root, target);
  const candidates = [
    { command: "tectonic", args: [relative, "--keep-logs", "--keep-intermediates"] },
    { command: "latexmk", args: ["-pdf", "-interaction=nonstopmode", relative] },
    { command: "xelatex", args: ["-interaction=nonstopmode", "-halt-on-error", relative] },
    { command: "pdflatex", args: ["-interaction=nonstopmode", "-halt-on-error", relative] },
  ];
  const candidate = candidates.find((item) => commandExists(item.command));
  if (!candidate) {
    return { status: "toolchain_missing", mainPath: relative, diagnostics: ["No TeX engine found on PATH."] };
  }
  const result = spawnSync(candidate.command, candidate.args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
  return {
    status: result.status === 0 ? "success" : "failed",
    engine: candidate.command,
    mainPath: relative,
    exitCode: result.status,
    diagnostics: `${result.stdout || ""}\n${result.stderr || ""}`
      .trim()
      .slice(-8000)
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => sanitizeText(line, 1024)),
  };
}

function requireWrite(allowWrite) {
  if (!allowWrite) {
    throw new Error("write_disabled");
  }
}

export function insertCitation(projectRoot, input, allowWrite = false) {
  requireWrite(allowWrite);
  const root = normalizeRoot(projectRoot);
  const target = resolveProjectPath(root, input.texPath, new Set([".tex"]));
  const key = String(input.citationKey || "").trim();
  if (!/^[A-Za-z0-9_:.+/-]{1,160}$/.test(key)) {
    throw new Error("invalid_citation_key");
  }
  const source = readTextBounded(target);
  const citation = `\\cite{${key}}`;
  let next = "";
  if (Number.isInteger(input.offset)) {
    const offset = Math.max(0, Math.min(source.length, Number(input.offset)));
    next = `${source.slice(0, offset)}${citation}${source.slice(offset)}`;
  } else if (input.marker && source.includes(input.marker)) {
    next = source.replace(input.marker, `${input.marker}${citation}`);
  } else {
    next = `${source.trimEnd()} ${citation}\n`;
  }
  atomicWriteText(root, target, next);
  return { path: repoPath(root, target), citation };
}

export function applyLatexEdit(projectRoot, input, allowWrite = false) {
  requireWrite(allowWrite);
  const root = normalizeRoot(projectRoot);
  const target = resolveProjectPath(root, input.path, writeExtensions);
  const source = readTextBounded(target);
  const search = String(input.search || "");
  const replace = String(input.replace || "");
  if (!search || !source.includes(search)) {
    throw new Error("search_not_found");
  }
  atomicWriteText(root, target, source.replace(search, replace));
  return { path: repoPath(root, target), changed: true };
}

function toolDefinitions(allowWrite, allowCompile) {
  const tools = [
    { name: "search_papers", description: "Search BibTeX entries in the LatoTex project.", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } } } },
    { name: "read_tex", description: "Read a LaTeX-related project file.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
    { name: "check_submission", description: "Run deterministic manuscript preflight checks.", inputSchema: { type: "object", properties: { mainPath: { type: "string" } } } },
    { name: "audit_citations", description: "Audit local citation keys against project BibTeX evidence.", inputSchema: { type: "object", properties: { mainPath: { type: "string" } } } },
  ];
  if (allowCompile) {
    tools.push({ name: "compile_tex", description: "Compile a TeX file after explicit standalone-server approval.", inputSchema: { type: "object", properties: { mainPath: { type: "string" } }, required: ["mainPath"] } });
  }
  if (allowWrite) {
    tools.push(
      { name: "insert_citation", description: "Insert a citation into a TeX file.", inputSchema: { type: "object", properties: { texPath: { type: "string" }, citationKey: { type: "string" }, offset: { type: "number" }, marker: { type: "string" } }, required: ["texPath", "citationKey"] } },
      { name: "apply_latex_edit", description: "Apply an exact SEARCH/REPLACE edit to a LaTeX-related file.", inputSchema: { type: "object", properties: { path: { type: "string" }, search: { type: "string" }, replace: { type: "string" } }, required: ["path", "search", "replace"] } },
    );
  }
  return tools;
}

export function callTool(projectRoot, allowWrite, name, args = {}, allowCompile = false) {
  const root = normalizeRoot(projectRoot);
  if (name === "search_papers") {
    return searchPapers(root, args.query, args.limit);
  }
  if (name === "read_tex") {
    const target = resolveProjectPath(root, args.path, textExtensions);
    const content = readTextBounded(target);
    const maxChars = Math.max(256, Math.min(16_384, Number(args.maxChars) || 16_384));
    return {
      path: repoPath(root, target),
      content: Array.from(content).slice(0, maxChars).join(""),
      truncated: Array.from(content).length > maxChars,
    };
  }
  if (name === "compile_tex") {
    if (!allowCompile) throw new Error("compile_disabled");
    return compileTex(root, args.mainPath);
  }
  if (name === "check_submission") {
    return checkSubmission(root, args.mainPath);
  }
  if (name === "audit_citations") {
    return auditCitations(root, args.mainPath);
  }
  if (name === "insert_citation") {
    return insertCitation(root, args, allowWrite);
  }
  if (name === "apply_latex_edit") {
    return applyLatexEdit(root, args, allowWrite);
  }
  throw new Error(`unknown_tool:${name}`);
}

function parseArgs(argv) {
  const projectRootIndex = argv.indexOf("--project-root");
  return {
    projectRoot: projectRootIndex >= 0 ? argv[projectRootIndex + 1] : process.cwd(),
    allowWrite: argv.includes("--allow-write") || process.env.LATOTEX_MCP_ALLOW_WRITE === "1",
    allowCompile: argv.includes("--allow-compile") || process.env.LATOTEX_MCP_ALLOW_COMPILE === "1",
  };
}

function success(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function failure(id, error) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32000, message: sanitizeText(error instanceof Error ? error.message : error, 512) },
  };
}

export function handleMcpMessage(message, options) {
  const id = message.id ?? null;
  try {
    if (message.method === "initialize") {
      return success(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "latotex-mcp", version: serverVersion },
      });
    }
    if (message.method === "tools/list") {
      return success(id, { tools: toolDefinitions(options.allowWrite, options.allowCompile) });
    }
    if (message.method === "tools/call") {
      const name = message.params?.name;
      const args = message.params?.arguments ?? {};
      const result = boundedResult(callTool(
        options.projectRoot,
        options.allowWrite,
        name,
        args,
        options.allowCompile,
      ));
      return success(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    }
    if (message.method === "notifications/initialized") {
      return null;
    }
    return failure(id, new Error(`unknown_method:${message.method}`));
  } catch (error) {
    return failure(id, error);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line.trim()) {
      return;
    }
    let response;
    if (Buffer.byteLength(line, "utf8") > resultLimit) {
      response = failure(null, new Error("request_too_large"));
    } else {
      try {
        response = handleMcpMessage(JSON.parse(line), options);
      } catch {
        response = failure(null, new Error("invalid_json"));
      }
    }
    if (response) {
      const payload = JSON.stringify(response);
      const safePayload = Buffer.byteLength(payload, "utf8") <= resultLimit
        ? payload
        : JSON.stringify(failure(response.id ?? null, new Error("result_too_large")));
      process.stdout.write(`${safePayload}\n`);
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
