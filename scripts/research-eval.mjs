import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
  auditCitations,
  checkSubmission,
  compileTex,
  handleMcpMessage,
  insertCitation,
  searchPapers,
} from "./latotex-mcp.mjs";
import { runKnowledgeRetrievalQualityFixture } from "./knowledge-retrieval-eval.mjs";

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

function normalizeDoi(value) {
  return String(value ?? "")
    .trim()
    .replace(/^https?:\/\/doi\.org\//i, "")
    .replace(/^doi:/i, "")
    .toLowerCase();
}

function academicEvidenceKey(item) {
  const doi = normalizeDoi(item.doi);
  if (doi) return `doi:${doi}`;
  if (item.arxivId) return `arxiv:${String(item.arxivId).toLowerCase()}`;
  const title = String(item.title).toLowerCase().replaceAll(/[^a-z0-9]+/g, "");
  const firstAuthor = String(item.authors?.[0] ?? "").toLowerCase().replaceAll(/[^a-z0-9]+/g, "");
  return `title:${title}|${firstAuthor}|${item.year ?? ""}`;
}

function mergeAcademicFixture(providerLists) {
  const merged = new Map();
  for (const list of providerLists) {
    list.forEach((item, rank) => {
      const score = 1 / (60 + rank + 1);
      const key = academicEvidenceKey(item);
      const existing = merged.get(key);
      if (existing) {
        existing.rrfScore += score;
        if (!existing.provenance.includes(item.source)) existing.provenance.push(item.source);
      } else {
        merged.set(key, { ...item, provenance: [item.source], rrfScore: score });
      }
    });
  }
  return [...merged.values()].sort((left, right) =>
    right.rrfScore - left.rrfScore
    || left.title.localeCompare(right.title)
    || left.stableId.localeCompare(right.stableId));
}

function mergeWebFixture(providerLists) {
  return providerLists.flatMap((list) => list).map((item) => ({
    ...item,
    provenance: [item.source],
    rrfScore: 0,
  }));
}

function evaluateEvidenceLedger(fixture) {
  const packets = fixture.evidencePackets;
  const packetIds = new Set(packets.map((packet) => packet.id));
  assert.equal(packetIds.size, packets.length);
  const replayable = packets.filter((packet) =>
    packet.source
    && packet.title
    && packet.excerpt
    && packet.locator?.section
    && createHash("sha256").update(packet.excerpt).digest("hex").length === 64);
  assert.ok(packets.some((packet) => packet.correctionStatus === "corrected"));
  assert.ok(packets.every((packet) => ["clear", "retracted", "corrected", "unknown"].includes(packet.retractionStatus)));

  const citedEvidenceIds = fixture.claimAssessments.flatMap((assessment) => assessment.evidenceIds);
  const validCitationCount = citedEvidenceIds.filter((id) => packetIds.has(id)).length;
  const unsupportedWithoutLabel = fixture.claimAssessments.filter((assessment) =>
    ["contradicted", "insufficient"].includes(assessment.status)
    && !assessment.requiresUnconfirmedLabel);
  assert.ok(fixture.claimAssessments
    .filter((assessment) => assessment.status === "supported")
    .every((assessment) => assessment.evidenceIds.length > 0));
  assert.ok(fixture.claimAssessments.every((assessment) => typeof assessment.repairAttempted === "boolean"));
  return {
    packetRecall: replayable.length / packets.length,
    citationAccuracy: citedEvidenceIds.length === 0 ? 1 : validCitationCount / citedEvidenceIds.length,
    unsupportedClaimRate: unsupportedWithoutLabel.length / fixture.claimAssessments.length,
  };
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleVariance(values) {
  const average = mean(values);
  return values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1);
}

function hedgesG(left, right) {
  const pooled = (((left.length - 1) * sampleVariance(left)) + ((right.length - 1) * sampleVariance(right)))
    / (left.length + right.length - 2);
  const correction = 1 - (3 / (4 * (left.length + right.length) - 9));
  return correction * (mean(left) - mean(right)) / Math.sqrt(pooled);
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

  const academicFixture = JSON.parse(
    fs.readFileSync(path.join(fixtureRoot, "academic-evidence.json"), "utf8"),
  );
  const mergedAcademic = mergeAcademicFixture(academicFixture.academicProviderLists);
  const repeatedMerge = mergeAcademicFixture(academicFixture.academicProviderLists);
  const mergedWeb = mergeWebFixture(academicFixture.webProviderLists);
  assert.deepEqual(
    mergedAcademic.map((item) => item.stableId),
    academicFixture.expectedAcademicStableIds,
  );
  assert.deepEqual(
    mergedAcademic.map(({ stableId, provenance, rrfScore }) => ({ stableId, provenance, rrfScore })),
    repeatedMerge.map(({ stableId, provenance, rrfScore }) => ({ stableId, provenance, rrfScore })),
  );
  assert.deepEqual(mergedAcademic[0].provenance, ["openalex", "crossref", "semantic_scholar"]);
  assert.deepEqual(mergedAcademic[1].provenance, ["arxiv", "semantic_scholar"]);
  assert.ok(mergedAcademic.some((item) => item.source === "europe_pmc"));
  assert.deepEqual(mergedWeb.map((item) => item.source), ["duckduckgo", "wikipedia"]);
  assert.ok(mergedWeb.every((item) => item.rrfScore === 0));

  const evidenceLedgerFixture = JSON.parse(
    fs.readFileSync(path.join(fixtureRoot, "evidence-ledger.json"), "utf8"),
  );
  const evidenceLedger = evaluateEvidenceLedger(evidenceLedgerFixture);
  assert.deepEqual(evidenceLedger, evidenceLedgerFixture.expected);

  const analysisResearchPlanBundle = path.join(tempRoot, "analysis-research-plan.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "src", "app", "hooks", "analysisResearchPlan.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    outfile: analysisResearchPlanBundle,
    logLevel: "silent",
  });
  const {
    buildAnalysisResearchPlan,
    buildEvidenceBibtex,
    buildResearchEvidenceContext,
    initialResearchStages,
  } = await import(pathToFileURL(analysisResearchPlanBundle).href);
  const localPlan = buildAnalysisResearchPlan({
    prompt: "Summarize missing values and distributions in @data.csv",
    sourceType: "data",
    inputFiles: ["data.csv"],
  });
  assert.equal(localPlan.networkRequirement, "not_needed");
  assert.equal(localPlan.networkReasonCode, "local_data_sufficient");
  assert.equal(
    initialResearchStages(localPlan).find((stage) => stage.id === "evidence")?.status,
    "skipped",
  );
  const categorizedResponse = {
    items: [{
      query: "fixture",
      ok: true,
      message: "academic.search.complete",
      results: mergedAcademic,
      academicResults: mergedAcademic,
      webResults: mergedWeb,
      providerErrors: [],
      providerHealth: [],
      networkUsed: true,
    }],
  };
  const evidenceContext = buildResearchEvidenceContext(categorizedResponse);
  assert.match(evidenceContext, /\[academic; abstract_support/);
  assert.match(evidenceContext, /\[general_web; provider=wikipedia; contextual_only]/);
  const evidenceBibtex = buildEvidenceBibtex(mergedAcademic);
  assert.match(evidenceBibtex, /Evidence level: abstract; providers: openalex, crossref, semantic_scholar/);
  assert.match(evidenceBibtex, /Evidence level: metadata; providers: arxiv, semantic_scholar/);

  const statisticalFixture = JSON.parse(
    fs.readFileSync(path.join(fixtureRoot, "statistical-analysis.json"), "utf8"),
  );
  assert.equal(mean(statisticalFixture.groupB) - mean(statisticalFixture.groupA), 10);
  assert.ok(Math.abs(hedgesG(statisticalFixture.groupA, statisticalFixture.groupB)) > 2);
  assert.equal(statisticalFixture.missingRows, 2);
  const analysisRunnerSource = fs.readFileSync(
    path.join(repoRoot, "src-tauri", "resources", "python", "analysis_runtime", "analysis_runner.py"),
    "utf8",
  );
  assert.match(analysisRunnerSource, /BOOTSTRAP_SEED\s*=\s*20260729/);
  assert.match(analysisRunnerSource, /BOOTSTRAP_ITERATIONS\s*=\s*2_000/);
  assert.match(analysisRunnerSource, /multipletests\(.*method="fdr_bh"/s);

  const knowledgeRetrieval = runKnowledgeRetrievalQualityFixture(
    path.join(fixtureRoot, "knowledge-retrieval.json"),
  );

  console.log(JSON.stringify({
    status: "ok",
    evidenceLedger,
    knowledgeRetrieval,
    checks: [
      "citation-search",
      "citation-audit",
      "submission-preflight",
      "submission-pack-fixture",
      "mcp-tools",
      "write-gate",
      "compile-smoke",
      "academic-web-evidence-categorization",
      "semantic-scholar-europe-pmc-fixtures",
      "identifier-first-stable-academic-rrf",
      "evidence-packet-replayability",
      "citation-reference-accuracy",
      "unsupported-claim-labeling",
      "local-data-network-skip",
      "bibtex-evidence-levels",
      "deterministic-statistics-fixture",
      "knowledge-exact-recall",
      "knowledge-document-recall-at-20",
      "knowledge-passage-recall-at-40",
      "knowledge-ndcg-at-20",
      "knowledge-citation-coverage",
    ],
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
