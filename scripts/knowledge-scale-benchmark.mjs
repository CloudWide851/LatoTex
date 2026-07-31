import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactsRoot = path.join(repoRoot, "artifacts");
const reportPath = path.join(artifactsRoot, "knowledge-scale-benchmark.json");
const markdownPath = path.join(artifactsRoot, "knowledge-scale-benchmark.md");

function integerOption(name, fallback, minimum, maximum) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

const documentCount = integerOption("documents", 50_000, 1, 50_000);
const chunksPerDocument = integerOption("chunks-per-document", 40, 1, 40);
const queryIterations = integerOption("iterations", 31, 5, 101);
const expectedChunkCount = documentCount * chunksPerDocument;
const fullScale = documentCount === 50_000 && expectedChunkCount === 2_000_000;
const keepDatabase = process.env.KNOWLEDGE_BENCH_KEEP_DB === "1";
const requireHybrid = process.argv.includes("--require-hybrid");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "latotex-knowledge-scale-"));
const databasePath = path.join(tempRoot, "knowledge-index.sqlite3");
const database = new DatabaseSync(databasePath);
const timings = {};

function measure(label, operation) {
  const started = performance.now();
  const value = operation();
  timings[label] = Math.round(performance.now() - started);
  return value;
}

function createSchema() {
  database.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;
    PRAGMA temp_store=MEMORY;
    PRAGMA cache_size=-131072;
    PRAGMA mmap_size=268435456;
    CREATE TABLE knowledge_items (
      item_id TEXT PRIMARY KEY,
      doc_number INTEGER NOT NULL UNIQUE,
      project_id TEXT NOT NULL,
      relative_path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      index_state TEXT NOT NULL,
      chunk_count INTEGER NOT NULL
    );
    CREATE TABLE knowledge_chunks (
      evidence_id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE knowledge_chunks_fts USING fts5(
      evidence_id UNINDEXED,
      text,
      tokenize='unicode61 remove_diacritics 2'
    );
    CREATE VIRTUAL TABLE knowledge_chunks_trigram USING fts5(
      evidence_id UNINDEXED,
      text,
      tokenize='trigram'
    );
  `);
}

function seedItems() {
  database.prepare(`
    WITH RECURSIVE docs(number) AS (
      VALUES(1)
      UNION ALL
      SELECT number + 1 FROM docs WHERE number < ?
    )
    INSERT INTO knowledge_items (
      item_id, doc_number, project_id, relative_path, title,
      source_kind, content_hash, index_state, chunk_count
    )
    SELECT
      printf('doc:%06d', number),
      number,
      'scale-project',
      printf('knowledge/document-%06d.md', number),
      printf('Research document %06d', number),
      'markdown',
      printf('sha256:scale-%06d', number),
      'ready',
      ?
    FROM docs
  `).run(documentCount, chunksPerDocument);
}

function seedChunks() {
  database.prepare(`
    WITH RECURSIVE chunk_numbers(number) AS (
      VALUES(0)
      UNION ALL
      SELECT number + 1 FROM chunk_numbers WHERE number + 1 < ?
    )
    INSERT INTO knowledge_chunks (evidence_id, item_id, chunk_index, text)
    SELECT
      printf('ev:%06d:%02d', item.doc_number, chunk.number),
      item.item_id,
      chunk.number,
      printf(
        'research document %d passage %d topic%d method%d anchor%dx%d reproducible evidence',
        item.doc_number,
        chunk.number,
        item.doc_number % 997,
        item.doc_number % 89,
        item.doc_number,
        chunk.number
      )
    FROM knowledge_items item
    CROSS JOIN chunk_numbers chunk
  `).run(chunksPerDocument);
}

function populateSearchIndexes() {
  database.exec(`
    CREATE INDEX idx_knowledge_chunks_item
      ON knowledge_chunks(item_id, chunk_index);
    INSERT INTO knowledge_chunks_fts (evidence_id, text)
      SELECT evidence_id, text FROM knowledge_chunks;
    INSERT INTO knowledge_chunks_trigram (evidence_id, text)
      SELECT evidence_id, text FROM knowledge_chunks;
    INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts) VALUES('optimize');
    INSERT INTO knowledge_chunks_trigram(knowledge_chunks_trigram) VALUES('optimize');
    PRAGMA wal_checkpoint(TRUNCATE);
  `);
}

function percentile(values, fraction) {
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1);
  return ordered[Math.max(0, index)];
}

let lexicalStatement;
let trigramStatement;
let seedDetailStatement;
let neighborStatement;

function prepareSearchStatements() {
  lexicalStatement = database.prepare(`
    SELECT evidence_id, bm25(knowledge_chunks_fts) AS rank
    FROM knowledge_chunks_fts
    WHERE knowledge_chunks_fts MATCH ?
    ORDER BY rank
    LIMIT 400
  `);
  trigramStatement = database.prepare(`
    SELECT evidence_id, bm25(knowledge_chunks_trigram) AS rank
    FROM knowledge_chunks_trigram
    WHERE knowledge_chunks_trigram MATCH ?
    ORDER BY rank
    LIMIT 400
  `);
  seedDetailStatement = database.prepare(`
    SELECT item_id, chunk_index
    FROM knowledge_chunks
    WHERE evidence_id = ?
  `);
  neighborStatement = database.prepare(`
    SELECT evidence_id
    FROM knowledge_chunks
    WHERE item_id = ? AND chunk_index = ?
  `);
}

function benchmarkQuery(index) {
  const documentNumber = Math.max(
    1,
    Math.floor(((index + 1) * documentCount) / (queryIterations + 1)),
  );
  const chunkNumber = (index * 7) % chunksPerDocument;
  return {
    query: `"anchor${documentNumber}x${chunkNumber}"`,
    expectedEvidenceId: `ev:${String(documentNumber).padStart(6, "0")}:${String(chunkNumber).padStart(2, "0")}`,
  };
}

function lexicalSearch(query) {
  return lexicalStatement.all(query);
}

function lexicalDeepProxy(query) {
  const candidates = new Map();
  lexicalStatement.all(query).forEach((row, rank) => {
    candidates.set(row.evidence_id, 2 + 1 / (60 + rank));
  });
  trigramStatement.all(query).forEach((row, rank) => {
    candidates.set(
      row.evidence_id,
      (candidates.get(row.evidence_id) ?? 0) + 4 + 1 / (60 + rank),
    );
  });
  const seeds = [...candidates.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 40);
  const expanded = new Set(candidates.keys());
  for (const [evidenceId] of seeds) {
    const seed = seedDetailStatement.get(evidenceId);
    if (!seed) continue;
    for (const chunkIndex of [seed.chunk_index - 1, seed.chunk_index + 1]) {
      if (chunkIndex < 0) continue;
      const neighbor = neighborStatement.get(seed.item_id, chunkIndex);
      if (neighbor) expanded.add(neighbor.evidence_id);
    }
  }
  return expanded;
}

function runLatencySamples() {
  const lexicalDurations = [];
  const proxyDurations = [];
  const misses = [];
  lexicalSearch(benchmarkQuery(0).query);
  lexicalDeepProxy(benchmarkQuery(0).query);
  for (let index = 0; index < queryIterations; index += 1) {
    const query = benchmarkQuery(index);
    let started = performance.now();
    const lexical = lexicalSearch(query.query);
    lexicalDurations.push(performance.now() - started);
    if (!lexical.some((row) => row.evidence_id === query.expectedEvidenceId)) {
      misses.push(query.expectedEvidenceId);
    }
    started = performance.now();
    lexicalDeepProxy(query.query);
    proxyDurations.push(performance.now() - started);
  }
  return {
    lexicalDurations,
    proxyDurations,
    misses,
  };
}

function renderMarkdown(report) {
  if (!report.latency || !report.database || !report.hardware) {
    return [
      "# Knowledge Scale Benchmark",
      "",
      `- Generated: ${report.generatedAt}`,
      `- Status: ${report.status}`,
      `- Error: ${report.error ?? "benchmark did not complete"}`,
      "",
    ].join("\n");
  }
  return [
    "# Knowledge Scale Benchmark",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Scale: ${report.scale.documents.toLocaleString("en-US")} documents / ` +
      `${report.scale.chunks.toLocaleString("en-US")} chunks`,
    `- Full acceptance scale: ${report.scale.fullScale ? "yes" : "no (focused validation)"}`,
    `- Database size: ${report.database.bytes.toLocaleString("en-US")} bytes`,
    `- Lexical p95: ${report.latency.lexicalP95Ms} ms / 300 ms budget`,
    `- Lexical + trigram + adjacency proxy p95: ${report.latency.lexicalDeepProxyP95Ms} ms`,
    `- Real semantic hybrid p95: ${report.latency.hybridP95Ms ?? "not verified"}`,
    `- Hybrid status: ${report.latency.hybridStatus}`,
    "",
    "## Hardware",
    "",
    `- CPU: ${report.hardware.cpu}`,
    `- Logical cores: ${report.hardware.logicalCores}`,
    `- Memory: ${report.hardware.totalMemoryBytes.toLocaleString("en-US")} bytes`,
    `- OS: ${report.hardware.platform} ${report.hardware.release} ${report.hardware.arch}`,
    `- Node: ${report.hardware.node}`,
    `- SQLite: ${report.hardware.sqlite}`,
    "",
    "## Build Timings",
    "",
    ...Object.entries(report.timings).map(([label, value]) => `- ${label}: ${value} ms`),
    "",
    "The proxy timing is not reported as semantic hybrid performance. A real ONNX model and " +
      "production HNSW index are required before the 1.5 s hybrid budget can be marked verified.",
    "",
  ].join("\n");
}

let report;
let exitCode = 0;
try {
  const totalStarted = performance.now();
  measure("schemaMs", createSchema);
  measure("itemsMs", () => {
    database.exec("BEGIN IMMEDIATE");
    seedItems();
    database.exec("COMMIT");
  });
  measure("chunksMs", () => {
    database.exec("BEGIN IMMEDIATE");
    seedChunks();
    database.exec("COMMIT");
  });
  measure("searchIndexesMs", populateSearchIndexes);
  prepareSearchStatements();
  const counts = database.prepare(`
    SELECT
      (SELECT count(*) FROM knowledge_items) AS documents,
      (SELECT count(*) FROM knowledge_chunks) AS chunks,
      (SELECT count(*) FROM knowledge_chunks_fts) AS fts_chunks,
      (SELECT count(*) FROM knowledge_chunks_trigram) AS trigram_chunks
  `).get();
  const samples = measure("queriesMs", runLatencySamples);
  const lexicalP95Ms = Number(percentile(samples.lexicalDurations, 0.95).toFixed(2));
  const proxyP95Ms = Number(percentile(samples.proxyDurations, 0.95).toFixed(2));
  const sqlite = database.prepare("SELECT sqlite_version() AS version").get().version;
  database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const databaseBytes = fs.statSync(databasePath).size;
  timings.totalMs = Math.round(performance.now() - totalStarted);
  const countMatches = counts.documents === documentCount
    && counts.chunks === expectedChunkCount
    && counts.fts_chunks === expectedChunkCount
    && counts.trigram_chunks === expectedChunkCount;
  const lexicalPassed = lexicalP95Ms <= 300 && samples.misses.length === 0;
  report = {
    generatedAt: new Date().toISOString(),
    status: countMatches && lexicalPassed ? "passed_with_hybrid_unverified" : "failed",
    scale: {
      documents: documentCount,
      chunks: expectedChunkCount,
      chunksPerDocument,
      fullScale,
    },
    database: {
      bytes: databaseBytes,
      retainedPath: keepDatabase ? databasePath : null,
    },
    counts,
    latency: {
      sampleCount: queryIterations,
      lexicalP95Ms,
      lexicalBudgetMs: 300,
      lexicalPassed,
      lexicalDeepProxyP95Ms: proxyP95Ms,
      hybridP95Ms: null,
      hybridBudgetMs: 1_500,
      hybridStatus: "unverified_no_production_onnx_hnsw",
    },
    recall: {
      exactQueries: queryIterations,
      misses: samples.misses,
      exactRecall: 1 - samples.misses.length / queryIterations,
    },
    hardware: {
      cpu: os.cpus()[0]?.model ?? "unknown",
      logicalCores: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      node: process.version,
      sqlite,
    },
    timings,
  };
  if (!countMatches || !lexicalPassed || (requireHybrid && report.latency.hybridP95Ms === null)) {
    exitCode = 1;
  }
} catch (error) {
  report = {
    generatedAt: new Date().toISOString(),
    status: "failed",
    error: error instanceof Error ? error.message : "knowledge benchmark failed",
    scale: { documents: documentCount, chunks: expectedChunkCount, fullScale },
    timings,
  };
  exitCode = 1;
} finally {
  database.close();
  fs.mkdirSync(artifactsRoot, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderMarkdown(report), "utf8");
  if (!keepDatabase) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

console.log(JSON.stringify(report, null, 2));
process.exitCode = exitCode;
