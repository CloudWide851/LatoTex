import { useCallback, useEffect, useMemo, useState } from "react";
import {
  analysisExportArtifact,
  analysisListReports,
  analysisSaveReport,
  runAgent,
  workspaceRevealInSystem,
} from "../../shared/api/desktop";
import type { AnalysisReportItem } from "../../shared/types/app";
import { getPyodideRunner } from "../../features/analysis/pyodide/runner";

type TranslationFn = (key: any) => string;

type AgentPlan = {
  title: string;
  steps: string[];
  insights: string[];
  summary: string;
  pythonScript: string;
};

export type AnalysisResultView = {
  runId: string;
  title: string;
  summary: string;
  steps: string[];
  insights: string[];
  labels: string[];
  values: number[];
  reportHtml: string;
  reportRelativePath?: string;
  assetRelativePaths: string[];
  chartDataUrl: string;
};

function parseAgentPlan(raw: string): AgentPlan {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    const parsed = JSON.parse(candidate) as Partial<AgentPlan>;
    return {
      title: parsed.title?.trim() || "Analysis Report",
      steps: Array.isArray(parsed.steps) ? parsed.steps.map((item) => String(item)) : [],
      insights: Array.isArray(parsed.insights) ? parsed.insights.map((item) => String(item)) : [],
      summary: parsed.summary?.trim() || "",
      pythonScript: parsed.pythonScript?.trim() || "",
    };
  } catch {
    return {
      title: "Analysis Report",
      steps: [],
      insights: [],
      summary: "",
      pythonScript: "",
    };
  }
}

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
  const width = 840;
  const height = 360;
  const padding = 48;
  const max = Math.max(...values, 1);
  const barWidth = Math.max(24, Math.floor((width - padding * 2) / Math.max(values.length, 1) - 16));
  const step = Math.max(1, Math.floor((width - padding * 2) / Math.max(values.length, 1)));

  const bars = values
    .map((value, index) => {
      const x = padding + index * step + 8;
      const barHeight = Math.max(6, Math.round((value / max) * (height - padding * 2)));
      const y = height - padding - barHeight;
      const label = labels[index] ?? `item-${index + 1}`;
      return `
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="6" fill="#10A37F" opacity="0.88" />
        <text x="${x + barWidth / 2}" y="${height - padding + 18}" text-anchor="middle" font-size="12" fill="#334155">${label}</text>
        <text x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle" font-size="12" fill="#0f172a">${value.toFixed(2)}</text>
      `;
    })
    .join("\n");

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" />
    <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#cbd5e1" />
    <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="#cbd5e1" />
    ${bars}
  </svg>`;
}

function buildReportHtml(result: AnalysisResultView): string {
  const steps = result.steps.map((item) => `<li>${item}</li>`).join("");
  const insights = result.insights.map((item) => `<li>${item}</li>`).join("");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${result.title}</title>
    <style>
      body { font-family: 'Segoe UI', sans-serif; margin: 24px; color: #0f172a; background: #f8fafc; }
      h1 { margin: 0 0 8px; font-size: 28px; }
      .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
      .muted { color: #64748b; font-size: 13px; }
      img { width: 100%; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; }
    </style>
  </head>
  <body>
    <h1>${result.title}</h1>
    <p class="muted">${new Date().toLocaleString()}</p>
    <section class="card">
      <h2>Summary</h2>
      <p>${result.summary || "No summary generated."}</p>
    </section>
    <section class="card">
      <h2>Process</h2>
      <ol>${steps}</ol>
    </section>
    <section class="card">
      <h2>Insights</h2>
      <ul>${insights}</ul>
    </section>
    <section class="card">
      <h2>Chart</h2>
      <img src="${result.chartDataUrl}" alt="analysis chart" />
    </section>
  </body>
</html>`;
}

function normalizeNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .slice(0, 32);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item)).slice(0, 32);
}

const DEFAULT_PYTHON_SCRIPT = [
  "import math",
  "labels = [f'p{i}' for i in range(1, 9)]",
  "values = [round((math.sin(i * 0.7) + 1.5) * 25 + i * 3, 3) for i in range(1, 9)]",
  "analysis_result = {",
  "  'labels': labels,",
  "  'values': values,",
  "  'insights': [",
  "    'Generated fallback trend data in Pyodide.',",
  "    'Values are suitable for demo rendering and report export.'",
  "  ]",
  "}",
].join("\n");

export function useAnalysisWorkspace(params: {
  projectId: string | null;
  selectedFile: string | null;
  editorContent: string;
  t: TranslationFn;
  setToast: (value: { type: "info" | "error"; message: string } | null) => void;
}) {
  const { projectId, selectedFile, editorContent, setToast, t } = params;
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AnalysisResultView | null>(null);
  const [reports, setReports] = useState<AnalysisReportItem[]>([]);

  const refreshReports = useCallback(async () => {
    if (!projectId) {
      setReports([]);
      return;
    }
    try {
      const response = await analysisListReports(projectId);
      setReports(response.reports);
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    }
  }, [projectId, setToast]);

  useEffect(() => {
    void refreshReports();
  }, [refreshReports]);

  const canRun = useMemo(() => Boolean(projectId && prompt.trim().length > 0), [projectId, prompt]);

  const runAnalysis = useCallback(async () => {
    if (!projectId || !prompt.trim()) {
      return;
    }
    setRunning(true);
    try {
      const planningPrompt = [
        "You are a data analysis planner.",
        "Return strict JSON with keys:",
        "title (string), steps (string[]), insights (string[]), summary (string), pythonScript (string).",
        "The pythonScript must set a variable analysis_result as dict with labels and values arrays.",
        "",
        `User request: ${prompt.trim()}`,
        selectedFile ? `Current file: ${selectedFile}` : "",
        editorContent ? `Current content:\n${editorContent.slice(0, 6000)}` : "",
      ].join("\n");

      const planned = await runAgent({
        projectId,
        role: "task",
        prompt: planningPrompt,
        contextRefs: selectedFile ? [`file:${selectedFile}`] : [],
      });
      const plan = parseAgentPlan(planned.output);
      const script = plan.pythonScript || DEFAULT_PYTHON_SCRIPT;
      const runner = getPyodideRunner();
      const raw = await runner.runScript(script, 60_000);
      const rawObj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const labels = normalizeStringArray(rawObj.labels);
      const values = normalizeNumberArray(rawObj.values);
      const insights = [
        ...plan.insights,
        ...normalizeStringArray(rawObj.insights),
      ].slice(0, 16);
      const normalizedLabels = labels.length > 0 ? labels : values.map((_, index) => `item-${index + 1}`);
      const normalizedValues = values.length > 0 ? values : [12, 23, 19, 31, 28];
      const svg = buildBarChartSvg(normalizedLabels, normalizedValues);
      const chartDataUrl = toBase64SvgDataUrl(svg);
      const runId = `${Date.now()}`;

      const baseResult: AnalysisResultView = {
        runId,
        title: plan.title || t("analysis.defaultTitle"),
        summary: plan.summary || t("analysis.defaultSummary"),
        steps: plan.steps.length > 0 ? plan.steps : [t("analysis.defaultStep")],
        insights,
        labels: normalizedLabels,
        values: normalizedValues,
        chartDataUrl,
        reportHtml: "",
        assetRelativePaths: [],
      };
      const reportHtml = buildReportHtml(baseResult);
      const saved = await analysisSaveReport({
        projectId,
        runId,
        title: baseResult.title,
        reportHtml,
        assets: [
          {
            fileName: "chart.svg",
            dataUrl: chartDataUrl,
          },
        ],
      });
      const nextResult: AnalysisResultView = {
        ...baseResult,
        reportHtml,
        reportRelativePath: saved.reportRelativePath,
        assetRelativePaths: saved.assetRelativePaths,
      };
      setResult(nextResult);
      await refreshReports();
      setToast({ type: "info", message: t("analysis.runDone") });
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setRunning(false);
    }
  }, [editorContent, projectId, prompt, refreshReports, selectedFile, setToast, t]);

  const exportArtifact = useCallback(async (relativePath: string) => {
    if (!projectId) {
      return;
    }
    try {
      await analysisExportArtifact(projectId, relativePath);
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    }
  }, [projectId, setToast]);

  const revealArtifact = useCallback(async (relativePath: string) => {
    if (!projectId) {
      return;
    }
    try {
      await workspaceRevealInSystem(projectId, relativePath);
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    }
  }, [projectId, setToast]);

  return {
    prompt,
    setPrompt,
    running,
    canRun,
    result,
    reports,
    runAnalysis,
    refreshReports,
    exportArtifact,
    revealArtifact,
  };
}
