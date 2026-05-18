import { invokeCommand } from "../../shared/api/core";
import {
  createProject,
  projectIntegrityStatus,
  projectPrepareSearchIndex,
  projectSearchContent,
} from "../../shared/api/projects";
import { runtimeLogInfo } from "../../shared/api/runtime";
import { getSettings } from "../../shared/api/settings";
import { getWorkspaceTree, readFile, writeFile } from "../../shared/api/workspace";

type SmokeStep = {
  name: string;
  ok: boolean;
  detail?: string;
};

type SmokeConfig = {
  enabled: boolean;
  reportPath?: string | null;
  progressPath?: string | null;
  scenario?: string | null;
};

async function recordProgress(stage: string, status: string, detail?: Record<string, unknown>) {
  await invokeCommand("app_smoke_progress", {
    input: {
      stage,
      status,
      detail,
    },
  }).catch(() => undefined);
}

async function recordStep<T>(
  steps: SmokeStep[],
  name: string,
  run: () => Promise<T>,
  detail?: (value: T) => string,
): Promise<T> {
  try {
    await recordProgress(name, "start");
    const value = await run();
    const stepDetail = detail?.(value);
    steps.push({ name, ok: true, detail: stepDetail });
    await recordProgress(name, "ok", stepDetail ? { detail: stepDetail } : undefined);
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    steps.push({ name, ok: false, detail: message });
    await recordProgress(name, "error", { message });
    throw error;
  }
}

async function finishSmoke(ok: boolean, status: string, steps: SmokeStep[], error?: unknown) {
  const message = error instanceof Error ? error.message : error ? String(error) : undefined;
  await recordProgress("smoke.finish.request", ok ? "ok" : "error", {
    status,
    error: message,
    steps: steps.length,
  });
  await invokeCommand("app_smoke_finish", {
    input: {
      ok,
      status,
      steps,
      error: message,
    },
  });
}

async function runDefaultSmokePath(steps: SmokeStep[]) {
  await recordStep(
    steps,
    "health.check",
    () => invokeCommand<{ version?: string }>("health_check"),
    (health) => health.version ?? "-",
  );
  await recordStep(
    steps,
    "runtime.info",
    () => runtimeLogInfo(),
    (info) => `${info.installMode}:${info.version}`,
  );
  await recordStep(
    steps,
    "settings.load",
    () => getSettings(),
    (settings) => settings.uiPrefs?.language ?? "-",
  );
  const project = await recordStep(
    steps,
    "project.create",
    () => createProject(`Smoke Project ${Date.now()}`),
    (snapshot) => snapshot.summary.id,
  );
  const projectId = project.summary.id;
  await recordStep(steps, "file.write", () =>
    writeFile(projectId, "main.tex", "\\documentclass{article}\n\\begin{document}\nSmoke path\n\\end{document}\n"),
  );
  await recordStep(
    steps,
    "file.read",
    () => readFile(projectId, "main.tex"),
    (file) => `${file.relativePath}:${file.content.includes("Smoke path")}`,
  );
  await recordStep(
    steps,
    "workspace.tree",
    () => getWorkspaceTree(projectId),
    (tree) => String(tree.some((node) => node.relativePath === "main.tex")),
  );
  await recordStep(
    steps,
    "project.integrity",
    () => projectIntegrityStatus(projectId),
    (status) => `missing=${status.missingRequired.length}`,
  );
  await recordStep(
    steps,
    "project.searchIndex",
    () => projectPrepareSearchIndex(projectId),
    (result) => result.message,
  );
  await recordStep(
    steps,
    "project.search",
    () => projectSearchContent(projectId, "Smoke", 5, ["file_content"]),
    (hits) => String(hits.length),
  );
}

async function runGuiMatrixSmokePath(steps: SmokeStep[]) {
  const started = performance.now();
  await runDefaultSmokePath(steps);
  await recordStep(
    steps,
    "gui.viewport",
    async () => ({
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    }),
    (viewport) => `${viewport.width}x${viewport.height}@${viewport.devicePixelRatio}`,
  );
  for (let projectIndex = 0; projectIndex < 3; projectIndex += 1) {
    const project = await recordStep(
      steps,
      `gui.project.${projectIndex}.create`,
      () => createProject(`GUI Soak ${projectIndex} ${Date.now()}`),
      (snapshot) => snapshot.summary.id,
    );
    const projectId = project.summary.id;
    for (let fileIndex = 0; fileIndex < 4; fileIndex += 1) {
      await recordStep(steps, `gui.project.${projectIndex}.file.${fileIndex}.write`, () =>
        writeFile(
          projectId,
          `sections/matrix-${fileIndex}.tex`,
          `\\section{Matrix ${projectIndex}-${fileIndex}}\nGUI soak searchable content ${fileIndex}\n`,
        ),
      );
    }
    await recordStep(
      steps,
      `gui.project.${projectIndex}.tree`,
      () => getWorkspaceTree(projectId),
      (tree) => String(tree.length),
    );
    await recordStep(
      steps,
      `gui.project.${projectIndex}.search`,
      () => projectSearchContent(projectId, "searchable", 10, ["file_content"]),
      (hits) => String(hits.length),
    );
  }
  await recordStep(
    steps,
    "gui.duration",
    async () => Math.round(performance.now() - started),
    (durationMs) => `${durationMs}ms`,
  );
}

async function runSmokePath(scenario?: string | null) {
  const steps: SmokeStep[] = [];
  try {
    await recordProgress("smoke.started", "ok", { scenario: scenario ?? "default" });
    if (scenario === "gui-matrix") {
      await runGuiMatrixSmokePath(steps);
    } else {
      await runDefaultSmokePath(steps);
    }
    await finishSmoke(true, "passed", steps);
  } catch (error) {
    await finishSmoke(false, "failed", steps, error).catch(() => undefined);
  }
}

export function startTauriSmokeRunner() {
  if (typeof window === "undefined") {
    return;
  }
  void recordProgress("frontend.entry", "ok", {
    href: window.location.href,
    userAgent: window.navigator.userAgent,
  });
  window.setTimeout(() => {
    void recordProgress("react.mounted", "ok");
    void invokeCommand<SmokeConfig>("app_smoke_config")
      .then((config) => {
        void recordProgress("smoke.config", config.enabled ? "ok" : "disabled", {
          reportPath: config.reportPath,
          progressPath: config.progressPath,
          scenario: config.scenario,
        });
        if (config.enabled) {
          return runSmokePath(config.scenario);
        }
        return undefined;
      })
      .catch(() => undefined);
  }, 250);
}
