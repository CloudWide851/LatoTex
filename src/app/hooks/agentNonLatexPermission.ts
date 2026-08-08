import { readFile, writeFile } from "../../shared/api/workspace";
import type { MessageKey } from "../../i18n/messages/en-US/index";
import { requestAppChoice } from "../dialog/appDialogBridge";
import { isLatexPath, normalizePath } from "./agentPatchEdits";

type AgentPermissions = {
  version: number;
  allowedNonLatexTargets: string[];
};

async function loadAgentPermissions(activeProjectId: string): Promise<AgentPermissions> {
  try {
    const result = await readFile(activeProjectId, ".latotex/agent-permissions.json");
    const parsed = JSON.parse(result.content) as Partial<AgentPermissions>;
    return {
      version: 1,
      allowedNonLatexTargets: Array.isArray(parsed.allowedNonLatexTargets)
        ? parsed.allowedNonLatexTargets.map((item) => normalizePath(String(item)))
        : [],
    };
  } catch {
    return { version: 1, allowedNonLatexTargets: [] };
  }
}

async function saveAgentPermissions(activeProjectId: string, permissions: AgentPermissions) {
  await writeFile(
    activeProjectId,
    ".latotex/agent-permissions.json",
    `${JSON.stringify(permissions, null, 2)}\n`,
  );
}

export async function shouldAllowTargetPath(params: {
  activeProjectId: string;
  targetPath: string;
  explicitPath: boolean;
  t: (key: MessageKey) => string;
  setToast: (value: { type: "info" | "error"; message: string }) => void;
}): Promise<boolean> {
  const { activeProjectId, targetPath, explicitPath, t, setToast } = params;
  if (isLatexPath(targetPath)) {
    return true;
  }
  if (!explicitPath) {
    setToast({ type: "info", message: t("agent.nonLatexSkipped") });
    return false;
  }
  const permissions = await loadAgentPermissions(activeProjectId);
  if (permissions.allowedNonLatexTargets.includes(targetPath)) {
    return true;
  }
  const response = await requestAppChoice({
    title: t("agent.approval.title"),
    description: t("agent.nonLatexPrompt").replace("{path}", targetPath).trim(),
    choices: [
      { id: "yes", label: t("agent.approval.allowOnce") },
      { id: "remember", label: t("agent.approval.allowProject") },
      { id: "no", label: t("agent.approval.deny"), tone: "danger" },
    ],
  });
  if (response === "yes") {
    return true;
  }
  if (response === "remember") {
    permissions.allowedNonLatexTargets = Array.from(new Set([
      ...permissions.allowedNonLatexTargets,
      targetPath,
    ]));
    await saveAgentPermissions(activeProjectId, permissions);
    setToast({ type: "info", message: t("agent.nonLatexRemembered") });
    return true;
  }
  return false;
}
