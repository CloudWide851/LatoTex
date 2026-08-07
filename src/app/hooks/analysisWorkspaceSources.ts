import { analysisContextLoad, analysisEnvPrepare, analysisRunPython } from "../../shared/api/analysis";
import { runtimeLogWrite } from "../../shared/api/runtime";
import type { AnalysisContextItem, AnalysisPlan } from "../../shared/types/app";
import {
  isAnalysisContextFile,
  isAnalysisReferenceFile,
  isCandidateDataFile,
  loadDataSnapshots,
  type PaperAnalysisContext,
  type AnalysisSourceSnapshot,
} from "./analysisDataSources";
import { extractPromptRefValues, resolvePromptInputFiles } from "./analysisPromptRefs";
import {
  buildPythonProfileCacheKey,
  buildSnapshotSignature,
  readCachedAnalysisStageValue,
  trimCachedPythonProfile,
  type AnalysisStageCacheStore,
} from "./analysisStageCache";
import { summarizeSnapshotsForPrompt } from "./analysisWorkspaceHelpers";

type TranslationFn = (key: any) => string;

export type ResolvedAnalysisReferences = {
  explicit: boolean;
  structuredFiles: string[];
  contextFiles: string[];
};

export type MaterializedAnalysisContext = {
  requestedFiles: string[];
  snapshots: AnalysisSourceSnapshot[];
  sourceBlock: string;
  contextFiles: string[];
  contextRefs: string[];
};

export function shouldRunAnalysisPreflight(prompt: string, referenceFiles: string[]): boolean {
  if (extractPromptRefValues(prompt).length === 0) {
    return true;
  }
  const resolved = resolvePromptInputFiles(prompt, referenceFiles);
  return resolved.unresolved.length === 0 && resolved.resolved.some(isCandidateDataFile);
}

export function resolvePaperAnalysisContextReferences(
  context: Pick<PaperAnalysisContext, "sourcePath" | "pdfRelativePath">,
): { inputFiles: string[]; contextFiles: string[]; contextRefs: string[] } {
  const materializedPath = String(context.pdfRelativePath || context.sourcePath || "")
    .trim()
    .replace(/\\/g, "/");
  const contextRef = `${/\.pdf$/i.test(materializedPath) ? "paper" : "file"}:${materializedPath}`;
  return materializedPath
    ? { inputFiles: [], contextFiles: [materializedPath], contextRefs: [contextRef] }
    : { inputFiles: [], contextFiles: [], contextRefs: [] };
}

export function resolveAnalysisWorkspaceReferences(input: {
  prompt: string;
  referenceFiles: string[];
  structuredDataFiles: string[];
  planInputFiles?: string[];
  t: TranslationFn;
}): ResolvedAnalysisReferences {
  const { prompt, referenceFiles, structuredDataFiles, planInputFiles, t } = input;
  const explicit = extractPromptRefValues(prompt).length > 0;
  if (explicit) {
    const resolved = resolvePromptInputFiles(prompt, referenceFiles);
    if (resolved.unresolved.length > 0) {
      throw new Error(`${t("analysis.error.invalidInputRefs")}: ${resolved.unresolved.join(", ")}`);
    }
    const rejected = resolved.resolved.filter((path) => !isAnalysisReferenceFile(path));
    if (rejected.length > 0) {
      throw new Error(`${t("analysis.error.invalidInputRefs")}: ${rejected.join(", ")}`);
    }
    return {
      explicit: true,
      structuredFiles: resolved.resolved.filter(isCandidateDataFile),
      contextFiles: resolved.resolved.filter(isAnalysisContextFile),
    };
  }

  const structuredSet = new Set(structuredDataFiles.map((path) => path.replace(/\\/g, "/")));
  const planned = (planInputFiles ?? []).filter((path) => structuredSet.has(path.replace(/\\/g, "/")));
  const csvDefaults = structuredDataFiles.filter((path) => /\.(csv|tsv)$/i.test(path));
  return {
    explicit: false,
    structuredFiles: planned.length > 0
      ? planned
      : csvDefaults.length > 0
        ? csvDefaults
        : structuredDataFiles,
    contextFiles: [],
  };
}

export async function materializeAnalysisWorkspaceContext(input: {
  projectId: string;
  contextFiles: string[];
  t: TranslationFn;
}): Promise<MaterializedAnalysisContext> {
  const { projectId, contextFiles, t } = input;
  const response = await analysisContextLoad(projectId, contextFiles);
  if (response.issues.length > 0 || response.items.length !== contextFiles.length) {
    const failed = response.issues[0] ?? { path: "", code: "analysis.context.load_failed" };
    const pathSuffix = failed.path ? ` (${failed.path})` : "";
    throw new Error(`${contextIssueMessage(failed.code, t)}${pathSuffix}`);
  }
  return {
    requestedFiles: [...contextFiles],
    sourceBlock: contextSourceBlock(response.items),
    contextFiles: response.items.map((item) => item.path),
    contextRefs: response.items.map((item) => (
      item.kind === "pdf" ? `paper:${item.path}` : `file:${item.path}`
    )),
    snapshots: response.items.map((item): AnalysisSourceSnapshot => ({
      path: item.path,
      kind: item.kind === "pdf" ? "paper" : "text",
      summary: `chars=${item.originalChars}, truncated=${item.truncated ? "yes" : "no"}`,
      excerpt: item.content,
    })),
  };
}

export async function resolveAndPreloadAnalysisWorkspaceReferences(input: {
  projectId: string;
  prompt: string;
  referenceFiles: string[];
  structuredDataFiles: string[];
  planInputFiles?: string[];
  t: TranslationFn;
}): Promise<{
  references: ResolvedAnalysisReferences;
  materializedContext?: MaterializedAnalysisContext;
}> {
  const references = resolveAnalysisWorkspaceReferences(input);
  const materializedContext = references.explicit && references.contextFiles.length > 0
    ? await materializeAnalysisWorkspaceContext({
        projectId: input.projectId,
        contextFiles: references.contextFiles,
        t: input.t,
      })
    : undefined;
  return { references, materializedContext };
}

function contextIssueMessage(code: string, t: TranslationFn): string {
  if (code === "analysis.context.too_many_files" || code === "analysis.context.too_many_pdfs") {
    return t("analysis.error.contextLimit");
  }
  if (code === "analysis.context.too_large") {
    return t("analysis.error.contextTooLarge");
  }
  if (
    code === "analysis.context.path_invalid"
    || code === "analysis.context.reparse_denied"
    || code === "analysis.context.credential_denied"
    || code === "analysis.context.dotfile_denied"
  ) {
    return t("analysis.error.contextUnsafe");
  }
  if (code === "analysis.context.unsupported_type" || code === "analysis.context.binary_denied") {
    return t("analysis.error.contextUnsupported");
  }
  if (code === "analysis.context.invalid_pdf" || code === "analysis.context.pdf_extract_failed") {
    return t("analysis.error.contextPdf");
  }
  return t("analysis.error.contextLoad");
}

function contextSourceBlock(items: AnalysisContextItem[]): string {
  return items.map((item) => {
    const metadata = item.kind === "pdf"
      ? `kind=pdf, pages=${item.pageCount ?? 0}, engine=${item.extractionEngine ?? "unknown"}`
      : `kind=text, originalChars=${item.originalChars}`;
    return [
      `Workspace context (${item.path}; ${metadata}; truncated=${item.truncated ? "yes" : "no"}):`,
      item.content,
    ].join("\n");
  }).join("\n\n---\n\n");
}

export async function prepareAnalysisWorkspaceSources(input: {
  projectId: string;
  taskId: string;
  prompt: string;
  outputLanguageLabel: string;
  promptSignature: string;
  references: ResolvedAnalysisReferences;
  materializedContext?: MaterializedAnalysisContext;
  analysisPlan?: AnalysisPlan;
  stageCache: AnalysisStageCacheStore;
  persistStageCacheEntry: (key: string, value: unknown) => Promise<void>;
  onStage: (stage: "loadData" | "profileEachFile" | "loadContext") => void;
  t: TranslationFn;
}): Promise<{
  snapshots: AnalysisSourceSnapshot[];
  sourceBlock: string;
  inputFiles: string[];
  contextFiles: string[];
  contextRefs: string[];
}> {
  const {
    projectId,
    taskId,
    prompt,
    outputLanguageLabel,
    promptSignature,
    references,
    materializedContext,
    analysisPlan,
    stageCache,
    persistStageCacheEntry,
    onStage,
    t,
  } = input;
  if (references.structuredFiles.length === 0 && references.contextFiles.length === 0) {
    throw new Error(t("analysis.error.noInputFiles"));
  }

  const snapshots: AnalysisSourceSnapshot[] = [];
  const sourceParts: string[] = [];
  const contextRefs: string[] = [];
  if (references.structuredFiles.length > 0) {
    onStage("loadData");
    const dataSnapshots = await loadDataSnapshots(projectId, references.structuredFiles);
    snapshots.push(...dataSnapshots);
    onStage("profileEachFile");
    const snapshotSignature = buildSnapshotSignature(dataSnapshots);
    const pythonProfileCacheKey = buildPythonProfileCacheKey(
      outputLanguageLabel,
      promptSignature,
      snapshotSignature,
    );
    let pythonProfile = readCachedAnalysisStageValue<ReturnType<typeof trimCachedPythonProfile>>(
      stageCache,
      pythonProfileCacheKey,
    );
    if (pythonProfile) {
      await runtimeLogWrite(
        "INFO",
        `analysis cache hit: python profile, files=${dataSnapshots.length}`,
      ).catch(() => undefined);
    } else {
      const envStatus = await analysisEnvPrepare(projectId);
      const plan: AnalysisPlan = {
        ...(analysisPlan ?? {
          intent: prompt,
          targetColumns: [],
          missingValueStrategy: "complete_case",
          alpha: 0.05,
        }),
        inputFiles: references.structuredFiles,
      };
      pythonProfile = trimCachedPythonProfile(await analysisRunPython({
        projectId,
        taskId,
        prompt,
        outputLanguage: outputLanguageLabel,
        plan,
      }));
      await runtimeLogWrite(
        "INFO",
        `analysis python profile ready: source=${pythonProfile.runtimeSource}, files=${dataSnapshots.length}, python=${envStatus.pythonPath ?? "-"}`,
      ).catch(() => undefined);
      await persistStageCacheEntry(pythonProfileCacheKey, pythonProfile);
    }
    sourceParts.push([
      summarizeSnapshotsForPrompt(dataSnapshots),
      "Structured profile (python/uv):",
      JSON.stringify(pythonProfile.profileJson, null, 2).slice(0, 12_000),
    ].join("\n\n"));
    contextRefs.push(...references.structuredFiles.map((path) => `file:${path}`));
  }

  let loadedContextFiles: string[] = [];
  if (references.contextFiles.length > 0) {
    onStage("loadContext");
    const context = materializedContext ?? await materializeAnalysisWorkspaceContext({
      projectId,
      contextFiles: references.contextFiles,
      t,
    });
    loadedContextFiles = context.contextFiles;
    sourceParts.push(context.sourceBlock);
    snapshots.push(...context.snapshots);
    contextRefs.push(...context.contextRefs);
  }

  return {
    snapshots,
    sourceBlock: sourceParts.join("\n\n---\n\n"),
    inputFiles: references.structuredFiles,
    contextFiles: loadedContextFiles,
    contextRefs: Array.from(new Set(contextRefs)),
  };
}
