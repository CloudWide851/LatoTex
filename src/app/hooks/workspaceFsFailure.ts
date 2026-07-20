type TranslationFn = (key: any) => string;

const WORKSPACE_FAILURE_MESSAGE_KEY: Record<string, string> = {
  "workspace.path.invalid": "toast.workspacePathRejected",
  "workspace.path.outside_root": "toast.workspacePathRejected",
  "workspace.path.reparse_denied": "toast.workspacePathRejected",
  "workspace.path.recursive_target": "toast.workspacePathRejected",
  "workspace.path.root_unavailable": "toast.workspacePathUnavailable",
  "workspace.path.unavailable": "toast.workspacePathUnavailable",
  "workspace.path.unsupported_target": "toast.workspacePathUnavailable",
  "workspace.directory.not_directory": "toast.workspacePathUnavailable",
  "workspace.file_read.not_file": "toast.fileNotReadable",
  "workspace.file_read.access_denied": "toast.fileAccessDenied",
  "workspace.file_read.invalid_utf8": "toast.fileInvalidTextEncoding",
  "workspace.file_read.too_large": "toast.workspaceFileTooLarge",
  "workspace.file_write.too_large": "toast.workspaceFileTooLarge",
  "workspace.file_write.empty": "toast.workspaceWriteFailed",
  "workspace.file_write.verification_failed": "toast.workspaceWriteFailed",
  "workspace.file.atomic_write_failed": "toast.workspaceWriteFailed",
  "workspace.file.atomic_replace_failed": "toast.workspaceWriteFailed",
  "workspace.operation.failed": "toast.workspaceOperationFailed",
  "workspace.scope.unsupported": "toast.workspaceOperationFailed",
  "workspace.target.required": "toast.workspaceOperationFailed",
  "workspace.action.unsupported": "toast.workspaceOperationFailed",
};

export function resolveWorkspaceFsFailureCode(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const matches = message.match(/workspace\.[a-z0-9_.]+/gi) ?? [];
  return matches.find((candidate) => WORKSPACE_FAILURE_MESSAGE_KEY[candidate]) ?? null;
}

export function workspaceFsFailureMessage(error: unknown, t: TranslationFn): string {
  const code = resolveWorkspaceFsFailureCode(error);
  return t(code ? WORKSPACE_FAILURE_MESSAGE_KEY[code] : "toast.workspaceOperationFailed");
}
