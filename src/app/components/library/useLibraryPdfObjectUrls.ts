import { useEffect, useRef, useState } from "react";
import {
  buildWorkspacePreviewBinarySource,
  revokeObjectUrl,
  type WorkspacePreviewBinarySource,
} from "../../../shared/utils/workspacePreviewBlob";
import type { LibraryPdfPreview } from "../../../shared/types/app";

type Params = {
  projectId: string | null;
  enabled: boolean;
  previewRevision: number;
  cacheState: LibraryPdfPreview["cacheState"];
  sourcePdfRelativePath: string | null;
  translatedPdfRelativePath: string | null;
};

type ObjectUrlState = {
  pdfUrl: string | null;
  translatedPdfUrl: string | null;
  pdfSource: WorkspacePreviewBinarySource | null;
  translatedPdfSource: WorkspacePreviewBinarySource | null;
  loading: boolean;
  error: string | null;
};

const EMPTY_STATE: ObjectUrlState = {
  pdfUrl: null,
  translatedPdfUrl: null,
  pdfSource: null,
  translatedPdfSource: null,
  loading: false,
  error: null,
};

export function useLibraryPdfObjectUrls(params: Params): ObjectUrlState {
  const {
    projectId,
    enabled,
    previewRevision,
    cacheState,
    sourcePdfRelativePath,
    translatedPdfRelativePath,
  } = params;
  const [state, setState] = useState<ObjectUrlState>(EMPTY_STATE);
  const sourceUrlRef = useRef<string | null>(null);
  const translatedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const resetUrls = () => {
      revokeObjectUrl(sourceUrlRef.current);
      revokeObjectUrl(translatedUrlRef.current);
      sourceUrlRef.current = null;
      translatedUrlRef.current = null;
    };

    if (!enabled || !projectId || cacheState !== "ready" || !sourcePdfRelativePath) {
      resetUrls();
      setState(EMPTY_STATE);
      return () => {
        cancelled = true;
      };
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    void (async () => {
      let nextSource: WorkspacePreviewBinarySource | null = null;
      let nextTranslated: WorkspacePreviewBinarySource | null = null;
      try {
        nextSource = await buildWorkspacePreviewBinarySource(projectId, sourcePdfRelativePath);
        if (!nextSource) {
          throw new Error("library.viewer.pdfBlobUnavailable");
        }
        if (translatedPdfRelativePath) {
          try {
            nextTranslated = await buildWorkspacePreviewBinarySource(
              projectId,
              translatedPdfRelativePath,
            );
          } catch {
            nextTranslated = null;
          }
        }
        if (cancelled) {
          revokeObjectUrl(nextSource?.objectUrl);
          revokeObjectUrl(nextTranslated?.objectUrl);
          return;
        }
        resetUrls();
        sourceUrlRef.current = nextSource.objectUrl;
        translatedUrlRef.current = nextTranslated?.objectUrl ?? null;
        setState({
          pdfUrl: nextSource.objectUrl,
          translatedPdfUrl: nextTranslated?.objectUrl ?? null,
          pdfSource: nextSource,
          translatedPdfSource: nextTranslated,
          loading: false,
          error: null,
        });
      } catch (error) {
        revokeObjectUrl(nextSource?.objectUrl);
        revokeObjectUrl(nextTranslated?.objectUrl);
        if (!cancelled) {
          resetUrls();
          setState({
            pdfUrl: null,
            translatedPdfUrl: null,
            pdfSource: null,
            translatedPdfSource: null,
            loading: false,
            error: String(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cacheState, enabled, previewRevision, projectId, sourcePdfRelativePath, translatedPdfRelativePath]);

  useEffect(() => {
    return () => {
      revokeObjectUrl(sourceUrlRef.current);
      revokeObjectUrl(translatedUrlRef.current);
      sourceUrlRef.current = null;
      translatedUrlRef.current = null;
    };
  }, []);

  return state;
}
