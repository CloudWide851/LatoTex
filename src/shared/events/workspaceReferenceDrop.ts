export const WORKSPACE_REFERENCE_DROP_EVENT = "latotex:workspace-reference-drop";
export const WORKSPACE_REFERENCE_TARGET_ATTR = "data-explorer-reference-drop-target";

export type WorkspaceReferenceDropDetail = {
  projectId: string;
  scope: "workspace";
  paths: string[];
};

export function isWorkspaceReferenceDropDetail(value: unknown): value is WorkspaceReferenceDropDetail {
  if (!value || typeof value !== "object") {
    return false;
  }
  const detail = value as Partial<WorkspaceReferenceDropDetail>;
  return typeof detail.projectId === "string"
    && detail.projectId.trim().length > 0
    && detail.scope === "workspace"
    && Array.isArray(detail.paths)
    && detail.paths.length > 0
    && detail.paths.every((path) => typeof path === "string" && path.trim().length > 0);
}

export function dispatchWorkspaceReferenceDrop(detail: WorkspaceReferenceDropDetail): boolean {
  if (typeof window === "undefined" || !isWorkspaceReferenceDropDetail(detail)) {
    return false;
  }
  return window.dispatchEvent(new CustomEvent<WorkspaceReferenceDropDetail>(
    WORKSPACE_REFERENCE_DROP_EVENT,
    { detail },
  ));
}
