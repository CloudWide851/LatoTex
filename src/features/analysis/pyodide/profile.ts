import type { AnalysisSourceSnapshot } from "../../../app/hooks/analysisDataSources";
import { getPyodideRunner } from "./runner";
import { resolvePyodideSourceCandidates } from "./source";

export type PyodideAnalysisProfile = {
  runtimeSource: string;
  fileCount: number;
  totalRows: number;
  maxColumns: number;
  files: Array<{
    path: string;
    kind: string;
    rows?: number;
    columns?: number;
    summary: string;
    seriesMean?: number;
    issues: string[];
  }>;
  globalIssues: string[];
  chart: Array<{ label: string; value: number }>;
};

function toSerializableSnapshots(snapshots: AnalysisSourceSnapshot[]): Array<Record<string, unknown>> {
  return snapshots.slice(0, 24).map((snapshot) => ({
    path: snapshot.path,
    kind: snapshot.kind,
    rows: snapshot.rows,
    columns: snapshot.columns,
    summary: snapshot.summary,
    excerpt: snapshot.excerpt.slice(0, 3200),
    numericSeries: Array.isArray(snapshot.numericSeries)
      ? snapshot.numericSeries.slice(0, 24).map((item) => ({
          label: item.label,
          value: item.value,
        }))
      : [],
  }));
}

const PYODIDE_PROFILE_SCRIPT = [
  "files_input = analysis_context.get('snapshots', [])",
  "profile_files = []",
  "global_issues = []",
  "total_rows = 0",
  "max_columns = 0",
  "",
  "def _to_int(value):",
  "    if value is None:",
  "        return None",
  "    try:",
  "        number = int(value)",
  "        return number if number >= 0 else None",
  "    except Exception:",
  "        return None",
  "",
  "for item in files_input:",
  "    path = str(item.get('path', ''))",
  "    kind = str(item.get('kind', 'text'))",
  "    summary = str(item.get('summary', ''))",
  "    rows = _to_int(item.get('rows'))",
  "    columns = _to_int(item.get('columns'))",
  "    if rows is not None:",
  "        total_rows += rows",
  "    if columns is not None:",
  "        max_columns = max(max_columns, columns)",
  "",
  "    numeric_values = []",
  "    for pair in item.get('numericSeries', []):",
  "        try:",
  "            numeric_values.append(float(pair.get('value')))",
  "        except Exception:",
  "            pass",
  "",
  "    series_mean = round(sum(numeric_values) / len(numeric_values), 4) if numeric_values else None",
  "    issues = []",
  "    summary_lower = summary.lower()",
  "    if 'load failed' in summary_lower:",
  "        issues.append('load_failed')",
  "    if rows == 0:",
  "        issues.append('empty_rows')",
  "    if kind in ('csv', 'excel') and columns is not None and columns <= 1:",
  "        issues.append('low_column_count')",
  "    if kind in ('json', 'text') and len(str(item.get('excerpt', ''))) < 20:",
  "        issues.append('insufficient_excerpt')",
  "",
  "    profile_files.append({",
  "        'path': path,",
  "        'kind': kind,",
  "        'rows': rows,",
  "        'columns': columns,",
  "        'summary': summary,",
  "        'seriesMean': series_mean,",
  "        'issues': issues,",
  "    })",
  "",
  "for profile in profile_files:",
  "    for issue in profile.get('issues', []):",
  "        if issue not in global_issues:",
  "            global_issues.append(issue)",
  "",
  "chart = []",
  "for profile in profile_files[:12]:",
  "    rows = profile.get('rows')",
  "    if rows is None:",
  "        continue",
  "    filename = profile.get('path', '').split('/')[-1] or profile.get('path', '')",
  "    chart.append({'label': filename[:36], 'value': rows})",
  "",
  "analysis_result = {",
  "    'fileCount': len(profile_files),",
  "    'totalRows': total_rows,",
  "    'maxColumns': max_columns,",
  "    'files': profile_files,",
  "    'globalIssues': global_issues,",
  "    'chart': chart,",
  "}",
].join("\n");

export async function buildPyodideAnalysisProfile(input: {
  snapshots: AnalysisSourceSnapshot[];
  prompt: string;
  outputLanguage: string;
}): Promise<PyodideAnalysisProfile> {
  const runner = getPyodideRunner();
  const candidates = await resolvePyodideSourceCandidates();
  if (candidates.length === 0) {
    throw new Error("pyodide.init.failed");
  }
  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      await runner.initialize(candidate.source);
      const raw = await runner.runScript(PYODIDE_PROFILE_SCRIPT, {
        snapshots: toSerializableSnapshots(input.snapshots),
        prompt: input.prompt,
        outputLanguage: input.outputLanguage,
      });
      const parsed = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
      return {
        runtimeSource: candidate.name,
        fileCount: Number(parsed.fileCount ?? 0) || 0,
        totalRows: Number(parsed.totalRows ?? 0) || 0,
        maxColumns: Number(parsed.maxColumns ?? 0) || 0,
        files: Array.isArray(parsed.files)
          ? parsed.files.map((item) => {
              const record = item as Record<string, unknown>;
              const rows = Number(record.rows);
              const columns = Number(record.columns);
              const seriesMean = Number(record.seriesMean);
              return {
                path: String(record.path ?? ""),
                kind: String(record.kind ?? "text"),
                rows: Number.isFinite(rows) ? rows : undefined,
                columns: Number.isFinite(columns) ? columns : undefined,
                summary: String(record.summary ?? ""),
                seriesMean: Number.isFinite(seriesMean) ? seriesMean : undefined,
                issues: Array.isArray(record.issues) ? record.issues.map((entry) => String(entry)) : [],
              };
            })
          : [],
        globalIssues: Array.isArray(parsed.globalIssues) ? parsed.globalIssues.map((entry) => String(entry)) : [],
        chart: Array.isArray(parsed.chart)
          ? parsed.chart
              .map((item) => {
                const record = item as Record<string, unknown>;
                const value = Number(record.value ?? Number.NaN);
                return {
                  label: String(record.label ?? ""),
                  value,
                };
              })
              .filter((entry) => entry.label.trim().length > 0 && Number.isFinite(entry.value))
          : [],
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError instanceof Error ? lastError.message : String(lastError ?? "pyodide.init.failed"));
}

