import { invokeCommand } from "../../shared/api/core";
import {
  createProject,
  projectIntegrityStatus,
  projectPrepareSearchIndex,
  projectSearchContent,
} from "../../shared/api/projects";
import { getWorkspaceTree, readFile, writeFile } from "../../shared/api/workspace";

type SmokeStep = {
  name: string;
  ok: boolean;
  detail?: string;
};

type SmokeConfig = {
  enabled: boolean;
  reportPath?: string | null;
};

async function recordStep<T>(
  steps: SmokeStep[],
  name: string,
  run: () => Promise<T>,
  detail?: (value: T) => string,
): Promise<T> {
  try {
    const value = await run();
    steps.push({ name, ok: true, detail: detail?.(value) });
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    steps.push({ name, ok: false, detail: message });
    throw error;
  }
}

async function finishSmoke(ok: boolean, status: string, steps: SmokeStep[], error?: unknown) {
  const message = error instanceof Error ? error.message : error ? String(error) : undefined;
  await invokeCommand("app_smoke_finish", {
    input: {
      ok,
      status,
      steps,
      error: message,
    },
  });
}

async function runSmokePath() {
  const steps: SmokeStep[] = [];
  try {
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
    await finishSmoke(true, "passed", steps);
  } catch (error) {
    await finishSmoke(false, "failed", steps, error).catch(() => undefined);
  }
}

export function startTauriSmokeRunner() {
  if (typeof window === "undefined") {
    return;
  }
  window.setTimeout(() => {
    void invokeCommand<SmokeConfig>("app_smoke_config")
      .then((config) => {
        if (config.enabled) {
          return runSmokePath();
        }
        return undefined;
      })
      .catch(() => undefined);
  }, 250);
}
