import { useEffect, useRef, useState } from "react";
import {
  buildWorkspacePreviewBlobUrl,
  revokeObjectUrl,
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
  loading: boolean;
  error: string | null;
};

const EMPTY_STATE: ObjectUrlState = {
  pdfUrl: null,
  translatedPdfUrl: null,
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
      let nextSourceUrl: string | null = null;
      let nextTranslatedUrl: string | null = null;
      try {
        nextSourceUrl = await buildWorkspacePreviewBlobUrl(projectId, sourcePdfRelativePath);
        if (!nextSourceUrl) {
          throw new Error("library.viewer.pdfBlobUnavailable");
        }
        if (translatedPdfRelativePath) {
          try {
            nextTranslatedUrl = await buildWorkspacePreviewBlobUrl(
              projectId,
              translatedPdfRelativePath,
            );
          } catch {
            nextTranslatedUrl = null;
          }
        }
        if (cancelled) {
          revokeObjectUrl(nextSourceUrl);
          revokeObjectUrl(nextTranslatedUrl);
          return;
        }
        resetUrls();
        sourceUrlRef.current = nextSourceUrl;
        translatedUrlRef.current = nextTranslatedUrl;
        setState({
          pdfUrl: nextSourceUrl,
          translatedPdfUrl: nextTranslatedUrl,
          loading: false,
          error: null,
        });
      } catch (error) {
        revokeObjectUrl(nextSourceUrl);
        revokeObjectUrl(nextTranslatedUrl);
        if (!cancelled) {
          resetUrls();
          setState({
            pdfUrl: null,
            translatedPdfUrl: null,
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
