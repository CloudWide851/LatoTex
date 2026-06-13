import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditCitations,
  checkSubmission,
  compileTex,
  handleMcpMessage,
  insertCitation,
  searchPapers,
} from "./latotex-mcp.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(repoRoot, "tests", "fixtures", "research-eval");

function copyDir(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

function issueIds(report) {
  return report.issues.map((issue) => issue.id);
}

const submissionPackAllowlist = new Set([".tex", ".bib", ".sty", ".cls", ".bst", ".pdf", ".png", ".jpg", ".jpeg"]);

function listRelativeFiles(root, current = root, out = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      listRelativeFiles(root, fullPath, out);
    } else {
      out.push(path.relative(root, fullPath).replaceAll(path.sep, "/"));
    }
  }
  return out.sort();
}

function submissionPackAllowedFiles(root) {
  return listRelativeFiles(root).filter((item) => submissionPackAllowlist.has(path.extname(item).toLowerCase()));
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "latotex-research-eval-"));
try {
  const basicProject = path.join(tempRoot, "basic-paper");
  const brokenProject = path.join(tempRoot, "broken-paper");
  const packProject = path.join(tempRoot, "submission-pack");
  copyDir(path.join(fixtureRoot, "basic-paper"), basicProject);
  copyDir(path.join(fixtureRoot, "broken-paper"), brokenProject);
  copyDir(path.join(fixtureRoot, "submission-pack"), packProject);

  const papers = searchPapers(basicProject, "local research", 5);
  assert.equal(papers[0]?.citationKey, "smith2024");
  assert.equal(papers[0]?.sourcePath, "refs.bib");

  const basicReport = checkSubmission(basicProject, "main.tex");
  assert.ok(issueIds(basicReport).includes("missingFigures"));
  assert.ok(!issueIds(basicReport).includes("missingBibliography"));

  const brokenReport = checkSubmission(brokenProject, "main.tex");
  assert.ok(issueIds(brokenReport).includes("undefinedReferences"));
  assert.ok(issueIds(brokenReport).includes("missingBibliography"));

  const packReport = checkSubmission(packProject, "main.tex");
  assert.deepEqual(issueIds(packReport), ["ready"]);
  assert.deepEqual(submissionPackAllowedFiles(packProject), [
    "figures/result.png",
    "main.tex",
    "refs.bib",
  ]);

  const basicAudit = auditCitations(basicProject, "main.tex");
  assert.equal(basicAudit.status, "pass");
  assert.equal(basicAudit.summary.pass, 1);

  const brokenAudit = auditCitations(brokenProject, "main.tex");
  assert.equal(brokenAudit.status, "fail");
  assert.ok(brokenAudit.issues.some((issue) => issue.id === "missingCitationKeys"));

  const init = handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize" }, {
    projectRoot: basicProject,
    allowWrite: false,
  });
  assert.equal(init.result.serverInfo.name, "latotex-mcp");

  const listed = handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, {
    projectRoot: basicProject,
    allowWrite: false,
  });
  assert.ok(listed.result.tools.some((tool) => tool.name === "check_submission"));
  assert.ok(listed.result.tools.some((tool) => tool.name === "audit_citations"));
  assert.ok(!listed.result.tools.some((tool) => tool.name === "insert_citation"));

  const called = handleMcpMessage({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "search_papers", arguments: { query: "Smith", limit: 1 } },
  }, {
    projectRoot: basicProject,
    allowWrite: false,
  });
  assert.match(called.result.content[0].text, /smith2024/);

  assert.throws(
    () => insertCitation(basicProject, { texPath: "main.tex", citationKey: "smith2024" }, false),
    /write_disabled/,
  );

  const citationResult = insertCitation(
    basicProject,
    { texPath: "main.tex", citationKey: "smith2024", marker: "Prior work" },
    true,
  );
  assert.equal(citationResult.path, "main.tex");
  assert.match(fs.readFileSync(path.join(basicProject, "main.tex"), "utf8"), /Prior work\\cite\{smith2024\}/);

  const compileResult = compileTex(basicProject, "main.tex");
  assert.ok(["success", "failed", "toolchain_missing"].includes(compileResult.status));

  console.log(JSON.stringify({
    status: "ok",
    checks: [
      "citation-search",
      "citation-audit",
      "submission-preflight",
      "submission-pack-fixture",
      "mcp-tools",
      "write-gate",
      "compile-smoke",
    ],
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
