import { ExternalLink, FlaskConical, MousePointer2, Play, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { executeScientificCommand } from "../../../shared/api/workspace";
import type { ScientificCommandResponse } from "../../../shared/types/app";
import { Select } from "../../../components/ui/select";
import type { TranslationFn } from "../../types/i18n";

type ScientificAction = {
  pluginId: string;
  label: string;
  runFile: boolean;
  runSelection: boolean;
  openExternal: boolean;
};
type ScientificFailureKey =
  | "scientific.run.toolchainMissing"
  | "scientific.run.selectionEmpty"
  | "scientific.run.pluginDisabled"
  | "scientific.run.notebookInvalid"
  | "scientific.run.failed";

const RUNNERS: Record<string, Omit<ScientificAction, "pluginId"> & { extensions: string[] }> = {
  "latotex.science.matlab": {
    label: "MATLAB",
    extensions: ["m"],
    runFile: true,
    runSelection: true,
    openExternal: false,
  },
  "latotex.science.octave": {
    label: "GNU Octave",
    extensions: ["m"],
    runFile: true,
    runSelection: true,
    openExternal: false,
  },
  "latotex.science.r": {
    label: "R",
    extensions: ["r", "rmd"],
    runFile: true,
    runSelection: true,
    openExternal: false,
  },
  "latotex.science.julia": {
    label: "Julia",
    extensions: ["jl"],
    runFile: true,
    runSelection: true,
    openExternal: false,
  },
  "latotex.science.quarto": {
    label: "Quarto",
    extensions: ["qmd"],
    runFile: true,
    runSelection: false,
    openExternal: false,
  },
  "latotex.science.jupyter": {
    label: "Jupyter",
    extensions: ["ipynb"],
    runFile: true,
    runSelection: false,
    openExternal: false,
  },
};

const CONNECTORS: Record<string, Omit<ScientificAction, "pluginId"> & { extensions: string[] }> = {
  "latotex.science.zotero": {
    label: "Zotero",
    extensions: ["bib", "ris"],
    runFile: false,
    runSelection: false,
    openExternal: true,
  },
  "latotex.science.spss": {
    label: "IBM SPSS",
    extensions: ["sav", "zsav", "sps"],
    runFile: false,
    runSelection: false,
    openExternal: true,
  },
  "latotex.science.sas": {
    label: "SAS",
    extensions: ["sas", "sas7bdat"],
    runFile: false,
    runSelection: false,
    openExternal: true,
  },
  "latotex.science.stata": {
    label: "Stata",
    extensions: ["dta", "do", "ado"],
    runFile: false,
    runSelection: false,
    openExternal: true,
  },
  "latotex.science.imagej": {
    label: "ImageJ / Fiji",
    extensions: ["tif", "tiff", "png", "jpg", "jpeg", "gif"],
    runFile: false,
    runSelection: false,
    openExternal: true,
  },
  "latotex.science.qgis": {
    label: "QGIS",
    extensions: ["qgz", "qgs", "gpkg", "shp", "geojson"],
    runFile: false,
    runSelection: false,
    openExternal: true,
  },
};

export function scientificActionsForFile(
  path: string | null | undefined,
  enabledPluginIds: string[],
): ScientificAction[] {
  const extension = String(path ?? "").split(".").pop()?.toLowerCase() ?? "";
  const enabled = new Set(enabledPluginIds);
  return Object.entries({ ...RUNNERS, ...CONNECTORS })
    .filter(([pluginId, action]) => enabled.has(pluginId) && action.extensions.includes(extension))
    .map(([pluginId, action]) => ({
      pluginId,
      label: action.label,
      runFile: action.runFile && !(pluginId === "latotex.science.r" && extension === "rmd"),
      runSelection: action.runSelection,
      openExternal: action.openExternal,
    }));
}

function stableFailureKey(error: unknown): ScientificFailureKey {
  const value = String(error ?? "");
  if (value.includes("toolchain_missing")) {
    return "scientific.run.toolchainMissing";
  }
  if (value.includes("selection_empty")) {
    return "scientific.run.selectionEmpty";
  }
  if (value.includes("plugin_disabled") || value.includes("plugin_invalid")) {
    return "scientific.run.pluginDisabled";
  }
  if (value.includes("notebook_")) {
    return "scientific.run.notebookInvalid";
  }
  return "scientific.run.failed";
}

export function ScientificEditorRunControl(props: {
  projectId: string;
  selectedFile: string | null;
  editorContent: string;
  enabledPluginIds: string[];
  getSelectedCode: () => string;
  t: TranslationFn;
}) {
  const {
    projectId,
    selectedFile,
    editorContent,
    enabledPluginIds,
    getSelectedCode,
    t,
  } = props;
  const actions = useMemo(
    () => scientificActionsForFile(selectedFile, enabledPluginIds),
    [enabledPluginIds, selectedFile],
  );
  const [selectedPluginId, setSelectedPluginId] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [result, setResult] = useState<ScientificCommandResponse | null>(null);
  const [failureKey, setFailureKey] = useState<ScientificFailureKey | null>(null);

  useEffect(() => {
    setSelectedPluginId((current) => (
      actions.some((action) => action.pluginId === current)
        ? current
        : actions[0]?.pluginId ?? ""
    ));
    setResult(null);
    setFailureKey(null);
  }, [actions]);

  const active = actions.find((action) => action.pluginId === selectedPluginId) ?? actions[0];
  if (!active || !selectedFile) {
    return null;
  }

  const execute = async (
    commandId: "scientific.runFile" | "scientific.runSelection" | "scientific.openExternal",
  ) => {
    if (busyRef.current) {
      return;
    }
    const code = commandId === "scientific.runSelection" ? getSelectedCode() : editorContent;
    if (commandId === "scientific.runSelection" && !code.trim()) {
      setResult(null);
      setFailureKey("scientific.run.selectionEmpty");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setFailureKey(null);
    try {
      const next = await executeScientificCommand({
        projectId,
        pluginId: active.pluginId,
        commandId,
        relativePath: selectedFile,
        code,
      });
      setResult(next);
    } catch (error) {
      setResult(null);
      setFailureKey(stableFailureKey(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const dialogVisible = Boolean(result || failureKey);
  return (
    <>
      <div className="flex items-center gap-1">
        {actions.length > 1 ? (
          <Select
            uiSize="sm"
            wrapperClassName="w-32"
            value={active.pluginId}
            onChange={(event) => setSelectedPluginId(event.target.value)}
            aria-label={t("scientific.run.runtime")}
          >
            {actions.map((action) => (
              <option key={action.pluginId} value={action.pluginId}>{action.label}</option>
            ))}
          </Select>
        ) : (
          <span className="hidden text-[10px] text-slate-500 xl:inline">{active.label}</span>
        )}
        {active.runSelection ? (
          <button
            type="button"
            className="panel-topbar-btn editor-toolbar-btn motion-hover-rise disabled:opacity-50"
            disabled={busy}
            onClick={() => void execute("scientific.runSelection")}
            title={t("scientific.run.selection")}
            aria-label={t("scientific.run.selection")}
          >
            <MousePointer2 className="h-4 w-4" />
          </button>
        ) : null}
        {active.runFile ? (
          <button
            type="button"
            className="panel-topbar-btn editor-toolbar-btn motion-hover-rise disabled:opacity-50"
            disabled={busy}
            onClick={() => void execute("scientific.runFile")}
            title={t("scientific.run.file")}
            aria-label={t("scientific.run.file")}
          >
            {busy ? <FlaskConical className="h-4 w-4 animate-pulse" /> : <Play className="h-4 w-4" />}
          </button>
        ) : null}
        {active.openExternal ? (
          <button
            type="button"
            className="panel-topbar-btn editor-toolbar-btn motion-hover-rise disabled:opacity-50"
            disabled={busy}
            onClick={() => void execute("scientific.openExternal")}
            title={t("scientific.run.openExternal")}
            aria-label={t("scientific.run.openExternal")}
          >
            <ExternalLink className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {dialogVisible ? (
        <div className="fixed inset-0 z-[760] flex items-center justify-center bg-slate-950/35 p-4" role="presentation">
          <section
            className="app-material-floating flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label={t("scientific.run.outputTitle")}
          >
            <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold">{t("scientific.run.outputTitle")}</h3>
                <p className="mt-0.5 text-[11px] text-slate-500">{active.label}</p>
              </div>
              <button
                type="button"
                className="panel-topbar-btn editor-toolbar-btn"
                onClick={() => {
                  setResult(null);
                  setFailureKey(null);
                }}
                title={t("scientific.run.close")}
                aria-label={t("scientific.run.close")}
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="min-h-0 overflow-auto p-4 text-xs">
              {failureKey ? (
                <p className="app-status-danger rounded-xl border px-3 py-2" role="alert">{t(failureKey)}</p>
              ) : null}
              {result ? (
                <>
                  <p className={result.status === "completed" || result.status === "opened"
                    ? "app-status-success rounded-xl border px-3 py-2"
                    : "app-status-danger rounded-xl border px-3 py-2"}>
                    {t(result.status === "opened"
                      ? "scientific.run.opened"
                      : result.status === "completed"
                        ? "scientific.run.completed"
                        : "scientific.run.failed")}
                  </p>
                  {result.output ? (
                    <p className="mt-2 text-[11px] text-slate-500">
                      {t("scientific.run.summary")
                        .replace("{exitCode}", String(result.output.exitCode ?? "-"))
                        .replace("{duration}", String(result.output.durationMs))}
                    </p>
                  ) : null}
                  {result.output?.stdout ? (
                    <pre className="app-material-inset mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border p-3 font-mono">
                      {result.output.stdout}
                    </pre>
                  ) : null}
                  {result.output?.stderr ? (
                    <pre className="app-status-warning mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border p-3 font-mono">
                      {result.output.stderr}
                    </pre>
                  ) : null}
                  {result.output && !result.output.stdout && !result.output.stderr ? (
                    <p className="mt-3 text-slate-500">{t("scientific.run.noOutput")}</p>
                  ) : null}
                  {result.output?.truncated ? (
                    <p className="mt-2 text-amber-700">{t("scientific.run.truncated")}</p>
                  ) : null}
                </>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
