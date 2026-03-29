import type { SwarmEvent } from "../../shared/types/app";
import type { AnalysisSourceSnapshot } from "./analysisDataSources";
import type { AnalysisOutputLanguage, AnalysisTask, AnalysisTaskRun } from "./analysisTypes";
import { nowIso } from "./analysisTypes";
import { waitForRunOutputWithPolicy } from "./runEventWait";

export type AgentEventCard = {
  id: string;
  runId: string;
  kind: string;
  stage: string;
  source: string;
  status: string;
  title: string;
  content: string;
  cardKey: string;
  createdAt: string;
  phase?: string;
  decision?: string;
  riskLevel?: string;
  nodeId?: string;
  parentNodeId?: string;
  artifactRefs?: string[];
  requiresApproval?: boolean;
};

export type AgentAnalysisPayload = {
  title?: string;
  summary?: string;
  steps?: string[];
  insights?: string[];
  sections?: Array<{ title: string; content: string }>;
  chart?: Array<{ label: string; value: number }>;
};

const MAX_PROMPT_SNAPSHOT = 2200;

function toBase64SvgDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const encoded = typeof window !== "undefined" ? window.btoa(binary) : "";
  return `data:image/svg+xml;base64,${encoded}`;
}

function buildBarChartSvg(labels: string[], values: number[]): string {
  const width = 980;
  const height = 420;
  const padding = 54;
  const max = Math.max(...values, 1);
  const barWidth = Math.max(24, Math.floor((width - padding * 2) / Math.max(values.length, 1) - 12));
  const step = Math.max(1, Math.floor((width - padding * 2) / Math.max(values.length, 1)));
  const bars = values
    .map((value, index) => {
      const x = padding + index * step + 6;
      const barHeight = Math.max(8, Math.round((value / max) * (height - padding * 2)));
      const y = height - padding - barHeight;
      const label = labels[index] ?? `item-${index + 1}`;
      return `
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="8" fill="url(#bar)" />
        <text x="${x + barWidth / 2}" y="${height - padding + 22}" text-anchor="middle" font-size="12" fill="#334155">${label}</text>
        <text x="${x + barWidth / 2}" y="${y - 10}" text-anchor="middle" font-size="12" fill="#0f172a">${value.toFixed(2)}</text>
      `;
    })
    .join("\n");
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#f8fafc" />
        <stop offset="100%" stop-color="#eef2ff" />
      </linearGradient>
      <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#14b8a6" />
        <stop offset="100%" stop-color="#0ea5e9" />
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#bg)" />
    <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#cbd5e1" />
    <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="#cbd5e1" />
    ${bars}
  </svg>`;
}

function reportText(language: AnalysisOutputLanguage) {
  if (language === "zh-CN") {
    return {
      generatedAt: "生成时间",
      summary: "摘要",
      methods: "方法与流程",
      findings: "关键发现",
      sections: "详细分析",
      chart: "图表",
      empty: "暂无内容",
      chartAlt: "分析图表",
    };
  }
  return {
    generatedAt: "Generated At",
    summary: "Summary",
    methods: "Methods",
    findings: "Key Findings",
    sections: "Detailed Analysis",
    chart: "Charts",
    empty: "No content",
    chartAlt: "analysis chart",
  };
}

function toCardKind(kind: string): string {
  if (kind.startsWith("a2a.")) {
    return "a2a";
  }
  if (kind.startsWith("mcp.")) {
    return "mcp";
  }
  if (kind.startsWith("responses.")) {
    return "responses";
  }
  if (kind.startsWith("agent.run")) {
    return "run";
  }
  return "other";
}

export function toArtifactRefs(payload: Record<string, unknown>): string[] {
  if (!Array.isArray(payload.artifactRefs)) {
    return [];
  }
  return payload.artifactRefs
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, 8);
}
export function parsePayloadJson(raw: string): AgentAnalysisPayload {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  const relaxedCandidate = (() => {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return candidate.slice(firstBrace, lastBrace + 1);
    }
    return candidate;
  })();
  try {
    return JSON.parse(relaxedCandidate) as AgentAnalysisPayload;
  } catch {
    return {};
  }
}

export function clampChart(values: Array<{ label: string; value: number }>): Array<{ label: string; value: number }> {
  return values
    .filter((item) => item.label && Number.isFinite(item.value))
    .slice(0, 12)
    .map((item) => ({
      label: String(item.label).slice(0, 36),
      value: Number(item.value),
    }));
}

export function toChartFromSnapshots(snapshots: AnalysisSourceSnapshot[]): Array<{ label: string; value: number }> {
  const collected: Array<{ label: string; value: number }> = [];
  for (const item of snapshots) {
    if (Array.isArray(item.numericSeries) && item.numericSeries.length > 0) {
      for (const series of item.numericSeries) {
        collected.push({
          label: `${item.path.split("/").pop() || item.path}:${series.label}`.slice(0, 36),
          value: series.value,
        });
      }
    }
  }
  if (collected.length > 0) {
    return clampChart(collected);
  }
  return snapshots
    .slice(0, 12)
    .map((item, index) => ({
      label: item.path.split("/").pop() || `file-${index + 1}`,
      value: Number(item.rows ?? item.excerpt.length ?? index + 1),
    }));
}

export function buildReportHtml(input: {
  language: AnalysisOutputLanguage;
  title: string;
  summary: string;
  steps: string[];
  insights: string[];
  sections: Array<{ title: string; content: string }>;
  labels: string[];
  values: number[];
}): { html: string; chartDataUrl: string } {
  const chartSvg = buildBarChartSvg(input.labels, input.values);
  const chartDataUrl = toBase64SvgDataUrl(chartSvg);
  const text = reportText(input.language);
  const steps = input.steps.map((item) => `<li>${item}</li>`).join("");
  const insights = input.insights.map((item) => `<li>${item}</li>`).join("");
  const sections = input.sections
    .map((item) => `<article class=\"subcard\"><h3>${item.title}</h3><p>${item.content}</p></article>`)
    .join("");
  const html = `<!doctype html>
<html lang="${input.language === "zh-CN" ? "zh-CN" : "en"}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${input.title}</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;font-family:"Segoe UI",sans-serif;background:linear-gradient(135deg,#f8fafc,#eef2ff);color:#0f172a;padding:24px}
    .wrap{display:grid;gap:16px;max-width:1100px;margin:0 auto}
    .hero{padding:20px;border-radius:16px;background:#ffffffcc;border:1px solid #dbeafe;box-shadow:0 8px 24px rgba(15,23,42,.06)}
    .hero h1{margin:0 0 8px;font-size:30px}
    .muted{color:#64748b;font-size:13px}
    .card{padding:16px;border-radius:14px;background:white;border:1px solid #e2e8f0;box-shadow:0 4px 14px rgba(15,23,42,.04)}
    .card h2{margin:0 0 10px;font-size:18px}
    .subcard{padding:12px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;margin-bottom:10px}
    .subcard h3{margin:0 0 6px;font-size:14px}
    ol,ul{margin:0;padding-left:20px;line-height:1.7}
    img{max-width:100%;display:block;border-radius:10px;border:1px solid #e2e8f0;background:#fff}
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>${input.title}</h1>
      <p class="muted">${text.generatedAt}: ${new Date().toLocaleString()}</p>
    </section>
    <section class="card">
      <h2>${text.summary}</h2>
      <p>${input.summary || text.empty}</p>
    </section>
    <section class="card">
      <h2>${text.methods}</h2>
      <ol>${steps}</ol>
    </section>
    <section class="card">
      <h2>${text.findings}</h2>
      <ul>${insights}</ul>
    </section>
    <section class="card">
      <h2>${text.sections}</h2>
      ${sections || `<p>${text.empty}</p>`}
    </section>
    <section class="card">
      <h2>${text.chart}</h2>
      <img src="${chartDataUrl}" alt="${text.chartAlt}" />
    </section>
  </div>
</body>
</html>`;
  return { html, chartDataUrl };
}

export function extractEventCards(events: SwarmEvent[], runIds: string[]): AgentEventCard[] {
  if (runIds.length === 0) {
    return [];
  }
  const runSet = new Set(runIds);
  const filtered = events
    .filter((event) => runSet.has(event.runId))
    .filter((event) => event.kind !== "agent.run.heartbeat")
    .filter((event) => {
      const kind = toCardKind(event.kind);
      return kind === "a2a" || kind === "mcp" || kind === "responses" || kind === "run";
    })
    .sort((a, b) => a.seq - b.seq);
  const byCard = new Map<string, AgentEventCard>();
  for (const event of filtered) {
    const payload = event.payload ?? {};
    const cardKey =
      typeof payload.cardKey === "string" && payload.cardKey.trim().length > 0
        ? `${event.runId}:${payload.cardKey}`
        : `${event.runId}:${event.id}`;
    const append = payload.append === true;
    const content =
      typeof payload.content === "string"
        ? payload.content
        : typeof payload.output === "string"
          ? payload.output
          : "";
    const existing = byCard.get(cardKey);
    if (!existing) {
      byCard.set(cardKey, {
        id: event.id,
        runId: event.runId,
        kind: event.kind,
        stage: typeof payload.stage === "string" ? payload.stage : "run",
        source: typeof payload.source === "string" ? payload.source : event.role,
        status: typeof payload.status === "string" ? payload.status : "running",
        title: typeof payload.title === "string" ? payload.title : event.kind,
        content,
        cardKey,
        createdAt: event.createdAt,
        phase: typeof payload.phase === "string" ? payload.phase : undefined,
        decision: typeof payload.decision === "string" ? payload.decision : undefined,
        riskLevel: typeof payload.riskLevel === "string" ? payload.riskLevel : undefined,
        nodeId: typeof payload.nodeId === "string" ? payload.nodeId : undefined,
        parentNodeId: typeof payload.parentNodeId === "string" ? payload.parentNodeId : undefined,
        artifactRefs: toArtifactRefs(payload),
        requiresApproval: payload.requiresApproval === true,
      });
      continue;
    }
    existing.kind = event.kind;
    existing.status = typeof payload.status === "string" && payload.status ? payload.status : existing.status;
    existing.title = typeof payload.title === "string" && payload.title ? payload.title : existing.title;
    existing.stage = typeof payload.stage === "string" && payload.stage ? payload.stage : existing.stage;
    existing.source = typeof payload.source === "string" && payload.source ? payload.source : existing.source;
    existing.phase = typeof payload.phase === "string" && payload.phase ? payload.phase : existing.phase;
    existing.decision = typeof payload.decision === "string" && payload.decision ? payload.decision : existing.decision;
    existing.riskLevel = typeof payload.riskLevel === "string" && payload.riskLevel ? payload.riskLevel : existing.riskLevel;
    existing.nodeId = typeof payload.nodeId === "string" && payload.nodeId ? payload.nodeId : existing.nodeId;
    existing.parentNodeId = typeof payload.parentNodeId === "string" && payload.parentNodeId ? payload.parentNodeId : existing.parentNodeId;
    existing.artifactRefs = toArtifactRefs(payload);
    existing.requiresApproval = payload.requiresApproval === true || existing.requiresApproval;
    existing.content = append ? `${existing.content}${content}` : content || existing.content;
  }
  return Array.from(byCard.values());
}

export async function waitForRunOutput(runId: string): Promise<string> {
  return waitForRunOutputWithPolicy({
    runId,
    totalTimeoutMs: 45 * 60 * 1000,
    inactivityTimeoutMs: 0,
    eventLimit: 240,
    waitMs: 2_400,
    idleDelayMs: 120,
  });
}

export function summarizeSnapshotsForPrompt(snapshots: AnalysisSourceSnapshot[]): string {
  if (snapshots.length === 0) {
    return "No readable data files selected.";
  }
  return snapshots
    .map((item, index) => {
      const header = `${index + 1}. ${item.path} (${item.kind}) - ${item.summary}`;
      const excerpt = item.excerpt.slice(0, MAX_PROMPT_SNAPSHOT);
      return `${header}\n${excerpt}`;
    })
    .join("\n\n---\n\n");
}

export function deriveSections(payload: AgentAnalysisPayload): Array<{ title: string; content: string }> {
  const incoming = Array.isArray(payload.sections) ? payload.sections : [];
  const out = incoming
    .filter((item) => item && typeof item.title === "string" && typeof item.content === "string")
    .slice(0, 8)
    .map((item) => ({ title: item.title.trim(), content: item.content.trim() }))
    .filter((item) => item.title && item.content);
  return out;
}

function toLeanRun(run: AnalysisTaskRun): AnalysisTaskRun {
  return {
    ...run,
    reportHtml: undefined,
  };
}

export function upsertRun(task: AnalysisTask, run: AnalysisTaskRun): AnalysisTask {
  const leanRun = toLeanRun(run);
  const runs = [
    leanRun,
    ...task.runs
      .filter((item) => item.id !== run.id)
      .map((item) => toLeanRun(item)),
  ].slice(0, 40);
  return {
    ...task,
    activeRunId: run.id,
    runs,
    updatedAt: nowIso(),
  };
}



