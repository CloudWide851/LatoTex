import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const RRF_K = 60;
const EMBEDDING_DIMENSIONS = 384;

function createSchema(database) {
  database.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;
    CREATE TABLE knowledge_items (
      item_id TEXT PRIMARY KEY,
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
      anchor_json TEXT NOT NULL,
      text TEXT NOT NULL
    );
    CREATE INDEX idx_knowledge_chunks_item
      ON knowledge_chunks(item_id, chunk_index);
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

function stableHash(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function conceptVector(concept) {
  const vector = new Float32Array(EMBEDDING_DIMENSIONS);
  let state = stableHash(concept);
  for (let index = 0; index < 12; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const position = state % EMBEDDING_DIMENSIONS;
    vector[position] += (state & 1) === 0 ? 1 : -1;
  }
  const norm = Math.hypot(...vector) || 1;
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] /= norm;
  }
  return vector;
}

function cosine(left, right) {
  let score = 0;
  for (let index = 0; index < left.length; index += 1) {
    score += left[index] * right[index];
  }
  return score;
}

function seedFixture(database, fixture) {
  const insertItem = database.prepare(`
    INSERT INTO knowledge_items (
      item_id, project_id, relative_path, title, source_kind,
      content_hash, index_state, chunk_count
    ) VALUES (?, 'fixture-project', ?, ?, ?, ?, 'ready', ?)
  `);
  const insertChunk = database.prepare(`
    INSERT INTO knowledge_chunks (
      evidence_id, item_id, chunk_index, anchor_json, text
    ) VALUES (?, ?, ?, ?, ?)
  `);
  const insertFts = database.prepare(
    "INSERT INTO knowledge_chunks_fts (evidence_id, text) VALUES (?, ?)",
  );
  const insertTrigram = database.prepare(
    "INSERT INTO knowledge_chunks_trigram (evidence_id, text) VALUES (?, ?)",
  );
  const vectors = new Map();

  database.exec("BEGIN IMMEDIATE");
  try {
    for (const document of fixture.documents) {
      insertItem.run(
        document.id,
        document.path,
        document.title,
        document.sourceKind,
        document.contentHash,
        document.chunks.length,
      );
      document.chunks.forEach((chunk, chunkIndex) => {
        insertChunk.run(
          chunk.id,
          document.id,
          chunkIndex,
          JSON.stringify(chunk.anchor),
          chunk.text,
        );
        insertFts.run(chunk.id, chunk.text);
        insertTrigram.run(chunk.id, chunk.text);
        vectors.set(chunk.id, conceptVector(chunk.concept));
      });
    }
    for (let index = 0; index < fixture.syntheticDistractors; index += 1) {
      const itemId = `distractor-${String(index).padStart(3, "0")}`;
      const evidenceId = `${itemId}:0`;
      const relativePath = `background/${itemId}.md`;
      const text = [
        `Generic research document ${index}.`,
        "This reproducible study reports methods, data, results, evidence, model evaluation, and uncertainty.",
        `Background topic marker ${index}.`,
      ].join(" ");
      insertItem.run(
        itemId,
        relativePath,
        `Background research note ${index}`,
        "markdown",
        `sha256:distractor-${index}`,
        1,
      );
      insertChunk.run(
        evidenceId,
        itemId,
        0,
        JSON.stringify({ kind: "lines", value: "1-3", lineStart: 1, lineEnd: 3 }),
        text,
      );
      insertFts.run(evidenceId, text);
      insertTrigram.run(evidenceId, text);
      vectors.set(evidenceId, conceptVector(`distractor-${index % 31}`));
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return vectors;
}

function matchQuery(query) {
  const tokens = query
    .split(/[\s\p{P}]+/u)
    .map((value) => value.trim())
    .filter((value) => [...value].length >= 2)
    .slice(0, 12)
    .map((value) => `"${value.replaceAll('"', '""')}"`);
  return tokens.length > 0 ? tokens.join(" OR ") : null;
}

function addCandidate(candidates, evidenceId, score, kind) {
  const candidate = candidates.get(evidenceId) ?? { score: 0, matchKinds: new Set() };
  candidate.score += score;
  candidate.matchKinds.add(kind);
  candidates.set(evidenceId, candidate);
}

function addCandidateOnce(candidates, evidenceId, score, kind) {
  const candidate = candidates.get(evidenceId) ?? { score: 0, matchKinds: new Set() };
  if (!candidate.matchKinds.has(kind)) {
    candidate.score += score;
    candidate.matchKinds.add(kind);
  }
  candidates.set(evidenceId, candidate);
}

function runFts(database, table, query) {
  try {
    return database
      .prepare(`
        SELECT evidence_id, bm25(${table}) AS rank
        FROM ${table}
        WHERE ${table} MATCH ?
        ORDER BY rank
        LIMIT 400
      `)
      .all(query);
  } catch {
    return [];
  }
}

function searchFixture(database, vectors, querySpec) {
  const query = querySpec.query.trim();
  const candidates = new Map();
  const like = `%${query.toLowerCase()
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_")}%`;
  const exactRows = database.prepare(`
    SELECT c.evidence_id
    FROM knowledge_items i JOIN knowledge_chunks c
      ON c.item_id = i.item_id AND c.chunk_index = 0
    WHERE i.index_state = 'ready' AND (
      lower(i.title) LIKE ? ESCAPE '\\' OR
      lower(i.relative_path) LIKE ? ESCAPE '\\' OR
      lower(i.content_hash) = lower(?)
    )
    ORDER BY i.title COLLATE NOCASE, c.chunk_index
    LIMIT 400
  `).all(like, like, query);
  exactRows.forEach((row, rank) => {
    addCandidate(candidates, row.evidence_id, 4 + 1 / (RRF_K + rank), "exact");
  });

  const phrase = `"${query.replaceAll('"', '""')}"`;
  runFts(database, "knowledge_chunks_fts", phrase).forEach((row, rank) => {
    addCandidate(candidates, row.evidence_id, 4 + 1 / (RRF_K + rank), "exact");
  });
  if ([...query].length >= 3) {
    runFts(database, "knowledge_chunks_trigram", phrase).forEach((row, rank) => {
      addCandidate(candidates, row.evidence_id, 4 + 1 / (RRF_K + rank), "exact");
    });
  }
  const lexicalQuery = matchQuery(query);
  if (lexicalQuery) {
    runFts(database, "knowledge_chunks_fts", lexicalQuery).forEach((row, rank) => {
      addCandidate(candidates, row.evidence_id, 2 + 1 / (RRF_K + rank), "bm25");
    });
  }

  if (querySpec.semanticConcept) {
    const queryVector = conceptVector(querySpec.semanticConcept);
    [...vectors.entries()]
      .map(([evidenceId, vector]) => ({ evidenceId, similarity: cosine(queryVector, vector) }))
      .sort((left, right) => (
        right.similarity - left.similarity || left.evidenceId.localeCompare(right.evidenceId)
      ))
      .slice(0, 100)
      .forEach((row, rank) => {
        addCandidate(candidates, row.evidenceId, 1.5 + 1 / (RRF_K + rank), "semantic");
      });
  }

  const rankedSeeds = [...candidates.entries()]
    .sort((left, right) => right[1].score - left[1].score || left[0].localeCompare(right[0]))
    .slice(0, 40);
  for (const [evidenceId] of rankedSeeds) {
    const seed = database.prepare(
      "SELECT item_id, chunk_index FROM knowledge_chunks WHERE evidence_id = ?",
    ).get(evidenceId);
    if (!seed) continue;
    for (const chunkIndex of [seed.chunk_index - 1, seed.chunk_index + 1]) {
      if (chunkIndex < 0) continue;
      const neighbor = database.prepare(
        "SELECT evidence_id FROM knowledge_chunks WHERE item_id = ? AND chunk_index = ?",
      ).get(seed.item_id, chunkIndex);
      if (neighbor) addCandidateOnce(candidates, neighbor.evidence_id, 0.5, "adjacent");
    }
  }

  const details = database.prepare(`
    SELECT c.evidence_id, c.item_id, c.chunk_index, c.anchor_json, c.text,
           i.title, i.relative_path
    FROM knowledge_chunks c JOIN knowledge_items i ON i.item_id = c.item_id
    WHERE c.evidence_id = ?
  `);
  return [...candidates.entries()]
    .sort((left, right) => right[1].score - left[1].score || left[0].localeCompare(right[0]))
    .slice(0, 100)
    .map(([evidenceId, candidate]) => ({
      ...details.get(evidenceId),
      score: candidate.score,
      matchKinds: [...candidate.matchKinds].sort(),
    }));
}

function recall(expected, actual) {
  if (expected.length === 0) return 1;
  const actualSet = new Set(actual);
  return expected.filter((value) => actualSet.has(value)).length / expected.length;
}

function dcg(grades) {
  return grades.reduce(
    (sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2),
    0,
  );
}

function ndcgAt(results, relevanceGrades, limit) {
  const actualGrades = results
    .slice(0, limit)
    .map((result) => relevanceGrades[result.evidence_id] ?? 0);
  const idealGrades = Object.values(relevanceGrades)
    .sort((left, right) => right - left)
    .slice(0, limit);
  const ideal = dcg(idealGrades);
  return ideal === 0 ? 1 : dcg(actualGrades) / ideal;
}

function roundMetric(value) {
  return Number(value.toFixed(4));
}

export function runKnowledgeRetrievalQualityFixture(fixturePath) {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "latotex-knowledge-eval-"));
  const database = new DatabaseSync(path.join(tempRoot, "knowledge-index.sqlite3"));
  try {
    createSchema(database);
    const vectors = seedFixture(database, fixture);
    const runs = fixture.queries.map((query) => ({
      query,
      results: searchFixture(database, vectors, query),
    }));
    const exactRuns = runs.filter(({ query }) => query.exact);
    const exactRecall = exactRuns.reduce((sum, { query, results }) => (
      sum + recall(query.relevantPassages, results.slice(0, 20).map((item) => item.evidence_id))
    ), 0) / exactRuns.length;
    const documentRecallAt20 = runs.reduce((sum, { query, results }) => (
      sum + recall(query.relevantDocuments, results.slice(0, 20).map((item) => item.item_id))
    ), 0) / runs.length;
    const passageRecallAt40 = runs.reduce((sum, { query, results }) => (
      sum + recall(query.relevantPassages, results.slice(0, 40).map((item) => item.evidence_id))
    ), 0) / runs.length;
    const ndcgByQuery = runs.map(({ query, results }) => ({
      id: query.id,
      value: ndcgAt(results, query.relevanceGrades, 20),
      top: results.slice(0, 6).map((result) => result.evidence_id),
    }));
    const ndcg20 = ndcgByQuery.reduce((sum, item) => sum + item.value, 0) / runs.length;
    const citationRuns = runs.filter(({ query }) => query.citationRequired);
    const citationCoverage = citationRuns.filter(({ query, results }) => (
      query.relevantPassages.some((evidenceId) => (
        results.slice(0, 40).some((result) => result.evidence_id === evidenceId)
      ))
    )).length / citationRuns.length;
    const metrics = {
      exactRecall: roundMetric(exactRecall),
      recallAt20: roundMetric(documentRecallAt20),
      passageRecallAt40: roundMetric(passageRecallAt40),
      ndcgAt20: roundMetric(ndcg20),
      citationCoverage: roundMetric(citationCoverage),
      queryCount: runs.length,
      documentCount: fixture.documents.length + fixture.syntheticDistractors,
      chunkCount: [...vectors.keys()].length,
      semanticFixture: "deterministic-concept-vectors",
    };
    assert.ok(metrics.exactRecall >= 1, `exact recall ${metrics.exactRecall} is below 1`);
    assert.ok(metrics.recallAt20 >= 0.95, `Recall@20 ${metrics.recallAt20} is below 0.95`);
    assert.ok(
      metrics.passageRecallAt40 >= 0.95,
      `PassageRecall@40 ${metrics.passageRecallAt40} is below 0.95`,
    );
    assert.ok(
      metrics.ndcgAt20 >= 0.95,
      `nDCG@20 ${metrics.ndcgAt20} is below 0.95; ` +
      ndcgByQuery
        .sort((left, right) => left.value - right.value)
        .slice(0, 5)
        .map((item) => `${item.id}=${item.value.toFixed(4)}[${item.top.join("|")}]`)
        .join(", "),
    );
    assert.ok(
      metrics.citationCoverage >= 1,
      `citation coverage ${metrics.citationCoverage} is below 1`,
    );
    return metrics;
  } finally {
    database.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}
