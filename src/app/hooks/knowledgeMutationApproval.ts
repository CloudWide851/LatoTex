import { previewKnowledgeMutation } from "../../shared/api/knowledge";
import type { FsAction, FsScope } from "../../shared/types/app";

type TranslationFn = (key: any) => string;

export type KnowledgeMutationAction = Extract<FsAction, "rename" | "move" | "delete"> | "write";

export async function requestKnowledgeMutationApproval(input: {
  projectId: string;
  scope: FsScope;
  action: KnowledgeMutationAction;
  path: string;
  targetPath?: string;
  t: TranslationFn;
  confirm?: (message: string) => boolean;
}): Promise<string | null | undefined> {
  const preview = await previewKnowledgeMutation({
    projectId: input.projectId,
    scope: input.scope,
    action: input.action,
    path: input.path,
    targetPath: input.targetPath,
  });
  if (!preview.required) {
    return undefined;
  }
  const affected = preview.affectedItems
    .slice(0, 5)
    .map((item) => item.relativePath)
    .join("\n");
  const overflow = preview.affectedItems.length > 5
    ? `\n+${preview.affectedItems.length - 5}`
    : "";
  const message = [
    input.t("knowledge.confirmMutation"),
    "",
    `${input.t("knowledge.confirmMutationCount")}: ${preview.affectedItems.length}`,
    affected ? `${affected}${overflow}` : "",
  ].filter(Boolean).join("\n");
  const confirm = input.confirm ?? ((value: string) => window.confirm(value));
  if (!confirm(message)) {
    return null;
  }
  const token = preview.approval?.token;
  if (!token) {
    throw new Error("knowledge.approval.invalid");
  }
  return token;
}

export function knowledgeFailureMessage(error: unknown, t: TranslationFn): string {
  const code = String(error);
  if (code.includes("knowledge.archive.ocr_required")) {
    return t("knowledge.error.ocrRequired");
  }
  if (
    code.includes("knowledge.archive.format_unsupported")
    || code.includes("knowledge.archive.invalid_encoding")
    || code.includes("knowledge.archive.file_required")
  ) {
    return t("knowledge.error.unsupported");
  }
  return t("knowledge.error.failed");
}
