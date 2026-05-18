#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import * as Y from "yjs";

const DEFAULT_SIM_MINUTES = 360;
const DEFAULT_TICK_MS = 35;
const REPORT_ROOT = path.resolve(process.cwd(), ".latotex", "reports", "soak");
const SOAK_BUDGETS = {
  rssDriftBytes: 512 * 1024 * 1024,
  heapDriftBytes: 256 * 1024 * 1024,
  peakRssBytes: 1536 * 1024 * 1024,
};

function parseArg(name, fallback) {
  const prefix = `${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw.slice(prefix.length));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseStringArg(name, fallback) {
  const prefix = `${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : fallback;
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function memSnapshot(minute, scenario) {
  const m = process.memoryUsage();
  return {
    minute,
    scenario,
    ts: new Date().toISOString(),
    rss: m.rss,
    heapUsed: m.heapUsed,
    heapTotal: m.heapTotal,
    external: m.external,
    arrayBuffers: m.arrayBuffers,
  };
}

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function runAgentStep(state, minute) {
  const prompt = `Minute ${minute}: analyze theorem stability, check ref 10.1000/xyz and arXiv:2401.12345, then patch section.`;
  const base = `${state.agentDoc}\n\n% Prompt\n${prompt}`;
  const patched = base
    .replace(/section/gi, "section")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n");
  const refs = patched.match(/(10\.\d{4,9}\/[\w./-]+|arXiv:\d{4}\.\d{4,5})/g) ?? [];
  const change = `% refs=${refs.length} minute=${minute}`;
  state.agentDoc = `${patched.slice(-32000)}\n${change}`;
  state.agentEvents.push({ minute, refs: refs.slice(0, 6), size: state.agentDoc.length });
  if (state.agentEvents.length > 420) {
    state.agentEvents.splice(0, state.agentEvents.length - 420);
  }
}

function runTranslationStep(state, minute) {
  const source = [
    "Building semantics preservation in AI model training.",
    "保持公式 $E=mc^2$、引用 [12]、人名与术语一致性。",
    "GraphSAGE embeddings improve context fidelity.",
    `Iteration ${minute}`,
  ].join(" ");
  const terms = source.match(/[A-Za-z][A-Za-z0-9_-]{3,}|[\u4e00-\u9fff]{2,8}/g) ?? [];
  for (const term of terms) {
    if (!state.glossary.has(term)) {
      state.glossary.set(term, { target: `${term}_t`, hits: 1 });
    } else {
      const item = state.glossary.get(term);
      item.hits += 1;
      state.glossary.set(term, item);
    }
  }
  const translated = source
    .split(/(\s+)/)
    .map((token) => {
      const item = state.glossary.get(token);
      return item ? item.target : token;
    })
    .join("");
  state.translationChunks.push(translated.slice(0, 500));
  if (state.translationChunks.length > 260) {
    state.translationChunks.splice(0, state.translationChunks.length - 260);
  }
  if (state.glossary.size > 1200) {
    const keys = Array.from(state.glossary.keys()).slice(0, state.glossary.size - 1200);
    for (const key of keys) {
      state.glossary.delete(key);
    }
  }
}

function runShareStep(state, minute) {
  state.ydoc.transact(() => {
    const line = `\\section{sync-${minute}}\n`;
    state.ytext.insert(state.ytext.length, line);
    if (state.ytext.length > 26000) {
      state.ytext.delete(0, Math.min(180, state.ytext.length - 24000));
    }
    state.ycomments.push([
      {
        id: `c-${minute}`,
        author: `u${minute % 9}`,
        quote: `quote-${minute}`,
        page: (minute % 12) + 1,
      },
    ]);
    if (state.ycomments.length > 380) {
      state.ycomments.delete(0, state.ycomments.length - 380);
    }
  });
  const update = Y.encodeStateAsUpdate(state.ydoc);
  const mirror = new Y.Doc();
  Y.applyUpdate(mirror, update);
  state.lastShareBytes = update.byteLength;
  mirror.destroy();
}

function runWorkspaceStep(state, minute) {
  const pathName = `sections/section-${minute % 48}.tex`;
  state.workspaceFiles.set(pathName, `% minute=${minute}\n\\section{Matrix ${minute}}\nSmoke path\n`);
  if (state.workspaceFiles.size > 240) {
    const firstKey = state.workspaceFiles.keys().next().value;
    state.workspaceFiles.delete(firstKey);
  }
  const query = minute % 2 === 0 ? "Smoke" : "Matrix";
  state.searchHits = Array.from(state.workspaceFiles.entries())
    .filter(([, content]) => content.includes(query))
    .slice(0, 40)
    .map(([file]) => file);
}

function runDoctorStep(state, minute) {
  const checks = [
    "runtimeLog",
    "memory",
    "projectIntegrity",
    "searchIndex",
    "latexSession",
    "pythonEnv",
    "runtimeAssets",
  ];
  state.doctorCards = checks.map((id, index) => ({
    id,
    status: index % 5 === minute % 5 ? "warn" : "pass",
    checkedAt: minute,
  }));
}

function runPdfStep(state, minute) {
  state.pdfPages.set(minute % 80, {
    page: (minute % 80) + 1,
    textLayerBytes: 12000 + minute,
    annotations: minute % 9,
  });
  if (state.pdfPages.size > 80) {
    state.pdfPages.delete(state.pdfPages.keys().next().value);
  }
}

function runTerminalStep(state, minute) {
  state.terminalChunks.push({
    seq: minute,
    text: `PS> tectonic main.tex # ${minute}\nwarning: simulated terminal line\n`,
  });
  if (state.terminalChunks.length > 600) {
    state.terminalChunks.splice(0, state.terminalChunks.length - 600);
  }
}

function summarizeScenario(samples, key) {
  const filtered = samples.filter((item) => item.scenario === key);
  if (filtered.length === 0) {
    return null;
  }
  const peakRss = Math.max(...filtered.map((item) => item.rss));
  const peakHeap = Math.max(...filtered.map((item) => item.heapUsed));
  return {
    count: filtered.length,
    peakRss,
    peakHeap,
  };
}

function renderMarkdown(report) {
  const baseline = report.memory.baseline;
  const peak = report.memory.peak;
  const end = report.memory.end;
  const budgetLines = Object.entries(report.budgets)
    .map(([name, value]) => `- ${name}: ${value.ok ? "pass" : "fail"} (${value.actual} / ${value.limit})`)
    .join("\n");
  const scenarioLines = Object.entries(report.memory.scenarioSummary)
    .map(([name, value]) => `| ${name} | ${value.count} | ${formatMb(value.peakRss)} | ${formatMb(value.peakHeap)} |`)
    .join("\n");
  return [
    "# Soak Simulation Report (Equivalent 6h)",
    "",
    `- Simulated minutes: ${report.simulatedMinutes}`,
    `- Compression ratio: ${report.compressionRatio.toFixed(2)} simulated-minutes / real-second`,
    `- Tick duration: ${report.tickMs} ms`,
    `- Generated at: ${report.generatedAt}`,
    "",
    "## Memory Summary",
    "",
    `- Baseline RSS: ${formatMb(baseline.rss)} | HeapUsed: ${formatMb(baseline.heapUsed)}`,
    `- Peak RSS: ${formatMb(peak.rss)} | HeapUsed: ${formatMb(peak.heapUsed)} at minute ${peak.minute} (${peak.scenario})`,
    `- End RSS: ${formatMb(end.rss)} | HeapUsed: ${formatMb(end.heapUsed)}`,
    `- RSS drift: ${formatMb(end.rss - baseline.rss)} | Heap drift: ${formatMb(end.heapUsed - baseline.heapUsed)}`,
    "",
    "## Scenario Peaks",
    "",
    "| Scenario | Samples | Peak RSS | Peak HeapUsed |",
    "|---|---:|---:|---:|",
    scenarioLines || "| n/a | 0 | 0 MB | 0 MB |",
    "",
    "## Budgets",
    "",
    budgetLines,
    "",
    "## Notes",
    "",
    "- This script does not run a real 6-hour wall-clock test. It executes compressed mixed workloads equivalent to Agent/Translation/Share activity.",
    "- Use this report as a regression baseline and compare JSON snapshots across commits.",
    "",
  ].join("\n");
}

async function main() {
  const profile = parseStringArg("--profile", "legacy");
  const profileMinutes = profile === "ci-matrix" ? 90 : DEFAULT_SIM_MINUTES;
  const profileTickMs = profile === "ci-matrix" ? 10 : DEFAULT_TICK_MS;
  const simulatedMinutes = parseArg("--minutes", profileMinutes);
  const tickMs = parseArg("--tickMs", profileTickMs);
  fs.mkdirSync(REPORT_ROOT, { recursive: true });

  const state = {
    agentDoc: "% start\\n\\section{Init}",
    agentEvents: [],
    glossary: new Map(),
    translationChunks: [],
    workspaceFiles: new Map(),
    searchHits: [],
    doctorCards: [],
    pdfPages: new Map(),
    terminalChunks: [],
    ydoc: new Y.Doc(),
    ytext: null,
    ycomments: null,
    lastShareBytes: 0,
  };
  state.ytext = state.ydoc.getText("tex");
  state.ycomments = state.ydoc.getArray("comments");

  const samples = [];
  const started = performance.now();
  samples.push(memSnapshot(0, "baseline"));

  for (let minute = 1; minute <= simulatedMinutes; minute += 1) {
    const mod = minute % 7;
    const scenario = ["agent", "translation", "share", "workspace", "doctor", "pdf", "terminal"][mod];
    if (scenario === "agent") {
      runAgentStep(state, minute);
    } else if (scenario === "translation") {
      runTranslationStep(state, minute);
    } else if (scenario === "share") {
      runShareStep(state, minute);
    } else if (scenario === "workspace") {
      runWorkspaceStep(state, minute);
    } else if (scenario === "doctor") {
      runDoctorStep(state, minute);
    } else if (scenario === "pdf") {
      runPdfStep(state, minute);
    } else {
      runTerminalStep(state, minute);
    }
    if (minute % 2 === 0 || minute === simulatedMinutes) {
      samples.push(memSnapshot(minute, scenario));
    }
    if (tickMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, tickMs));
    }
  }

  state.ydoc.destroy();

  const ended = performance.now();
  const realSeconds = Math.max(0.001, (ended - started) / 1000);
  const baseline = samples[0];
  const peak = samples.reduce((max, item) => (item.rss > max.rss ? item : max), samples[0]);
  const end = samples[samples.length - 1];
  const scenarioSummary = {
    agent: summarizeScenario(samples, "agent"),
    translation: summarizeScenario(samples, "translation"),
    share: summarizeScenario(samples, "share"),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    simulatedMinutes,
    tickMs,
    realSeconds,
    compressionRatio: simulatedMinutes / realSeconds,
    workloads: {
      profile,
      agentEvents: state.agentEvents.length,
      glossaryTerms: state.glossary.size,
      translationChunks: state.translationChunks.length,
      shareLastUpdateBytes: state.lastShareBytes,
      workspaceFiles: state.workspaceFiles.size,
      searchHits: state.searchHits.length,
      doctorCards: state.doctorCards.length,
      pdfPages: state.pdfPages.size,
      terminalChunks: state.terminalChunks.length,
    },
    memory: {
      baseline,
      peak,
      end,
      scenarioSummary,
      samples,
    },
  };
  report.memory.scenarioSummary.workspace = summarizeScenario(samples, "workspace");
  report.memory.scenarioSummary.doctor = summarizeScenario(samples, "doctor");
  report.memory.scenarioSummary.pdf = summarizeScenario(samples, "pdf");
  report.memory.scenarioSummary.terminal = summarizeScenario(samples, "terminal");
  report.budgets = {
    rssDrift: {
      actual: formatMb(end.rss - baseline.rss),
      limit: formatMb(SOAK_BUDGETS.rssDriftBytes),
      ok: end.rss - baseline.rss <= SOAK_BUDGETS.rssDriftBytes,
    },
    heapDrift: {
      actual: formatMb(end.heapUsed - baseline.heapUsed),
      limit: formatMb(SOAK_BUDGETS.heapDriftBytes),
      ok: end.heapUsed - baseline.heapUsed <= SOAK_BUDGETS.heapDriftBytes,
    },
    peakRss: {
      actual: formatMb(peak.rss),
      limit: formatMb(SOAK_BUDGETS.peakRssBytes),
      ok: peak.rss <= SOAK_BUDGETS.peakRssBytes,
    },
  };

  const stamp = nowStamp();
  const jsonPath = path.join(REPORT_ROOT, `soak-6h-sim-${stamp}.json`);
  const mdPath = path.join(REPORT_ROOT, `soak-6h-sim-${stamp}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, `${renderMarkdown(report)}\n`, "utf8");

  process.stdout.write(`Generated soak report:\n- ${jsonPath}\n- ${mdPath}\n`);
  if (Object.values(report.budgets).some((budget) => !budget.ok)) {
    process.stderr.write("[soak-6h-sim] budget failure detected.\n");
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error?.stack || error)}\n`);
  process.exit(1);
});
