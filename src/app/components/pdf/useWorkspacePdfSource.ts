import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildWorkspacePreviewBlobUrl,
  revokeObjectUrl,
} from "../../../shared/utils/workspacePreviewBlob";

export function useWorkspacePdfSource(params: {
  pdfUrl: string | null;
  fallbackProjectId?: string | null;
  fallbackRelativePath?: string | null;
}) {
  const { pdfUrl, fallbackProjectId = null, fallbackRelativePath = null } = params;
  const [effectivePdfUrl, setEffectivePdfUrl] = useState<string | null>(pdfUrl);
  const blobUrlRef = useRef<string | null>(null);
  const fallbackBusyRef = useRef(false);

  useEffect(() => {
    revokeObjectUrl(blobUrlRef.current);
    blobUrlRef.current = null;
    fallbackBusyRef.current = false;
    setEffectivePdfUrl(pdfUrl);
  }, [pdfUrl, fallbackProjectId, fallbackRelativePath]);

  useEffect(() => {
    return () => {
      revokeObjectUrl(blobUrlRef.current);
      blobUrlRef.current = null;
    };
  }, []);

  const tryFallbackToBlob = useCallback(async (): Promise<boolean> => {
    if (!fallbackProjectId || !fallbackRelativePath || fallbackBusyRef.current) {
      return false;
    }
    if (blobUrlRef.current && effectivePdfUrl === blobUrlRef.current) {
      return false;
    }
    fallbackBusyRef.current = true;
    try {
      const nextUrl = await buildWorkspacePreviewBlobUrl(fallbackProjectId, fallbackRelativePath);
      if (!nextUrl) {
        return false;
      }
      revokeObjectUrl(blobUrlRef.current);
      blobUrlRef.current = nextUrl;
      setEffectivePdfUrl(nextUrl);
      return true;
    } catch {
      return false;
    } finally {
      fallbackBusyRef.current = false;
    }
  }, [effectivePdfUrl, fallbackProjectId, fallbackRelativePath]);

  return {
    effectivePdfUrl,
    tryFallbackToBlob,
    usingBlobFallback: Boolean(blobUrlRef.current && effectivePdfUrl === blobUrlRef.current),
  };
}

