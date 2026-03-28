const LOCAL_RESOURCE_SCHEME = "latotex-resource";
const WORKSPACE_FILE_ROUTE_PREFIX = "/workspace-file";

function encodePathSegment(value: string): string {
  return encodeURIComponent(String(value || "").trim());
}

function isHttpStyleRuntime(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  return /^https?:$/i.test(String(window.location?.protocol || ""));
}

export function buildWorkspaceResourceUrl(projectId: string, relativePath: string): string {
  const encodedProjectId = encodePathSegment(projectId);
  const encodedRelativePath = encodePathSegment(
    String(relativePath || "").trim().replace(/^\/+/, ""),
  );
  if (isHttpStyleRuntime()) {
    return `http://${LOCAL_RESOURCE_SCHEME}.localhost${WORKSPACE_FILE_ROUTE_PREFIX}/${encodedProjectId}/${encodedRelativePath}`;
  }
  return `${LOCAL_RESOURCE_SCHEME}://localhost${WORKSPACE_FILE_ROUTE_PREFIX}/${encodedProjectId}/${encodedRelativePath}`;
}

export async function fetchBinaryFromWorkspaceResource(
  projectId: string,
  relativePath: string,
): Promise<Uint8Array> {
  const response = await fetch(buildWorkspaceResourceUrl(projectId, relativePath), {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`workspace resource fetch failed: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
