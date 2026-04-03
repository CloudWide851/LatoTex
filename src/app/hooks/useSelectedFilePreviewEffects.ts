import { useEffect, useRef } from "react";
import { readFile } from "../../shared/api/workspace";
import { isExcelPath, isImagePath, isPdfPath } from "../../shared/utils/fileKind";
import { buildWorkspaceResourceUrl, buildWorkspacePreviewUrl } from "../../shared/utils/workspaceResource";

type ToastSetter = (value: { type: "info" | "error"; message: string } | null) => void;

export function useSelectedFilePreviewEffects(params: {
  activeProjectId: string | null;
  selectedFile: string | null;
  page: string;
  previewOverridePath: string | null;
  setEditorContent: (value: string) => void;
  setSelectedFilePdfUrl: (value: string | null) => void;
  setSelectedImagePreviewUrl: (value: string | null) => void;
  setSelectedTextFileReadyPath: (value: string | null) => void;
  setToast: ToastSetter;
  getCachedTextContent?: (relativePath: string) => string | null;
  onTextFileLoaded?: (relativePath: string, content: string) => void;
}) {
  const {
    activeProjectId,
    selectedFile,
    page,
    previewOverridePath,
    setEditorContent,
    setSelectedFilePdfUrl,
    setSelectedImagePreviewUrl,
    setSelectedTextFileReadyPath,
    setToast,
    getCachedTextContent,
    onTextFileLoaded,
  } = params;

  const selectedFilePdfUrlRef = useRef<string | null>(null);
  const selectedImageUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeProjectId || !selectedFile) {
      setSelectedTextFileReadyPath(null);
      setEditorContent("");
      return;
    }
    if (isPdfPath(selectedFile) || isExcelPath(selectedFile) || isImagePath(selectedFile)) {
      setSelectedTextFileReadyPath(null);
      setEditorContent("");
      return;
    }

    let cancelled = false;
    const cached = getCachedTextContent?.(selectedFile);
    if (typeof cached === "string") {
      setEditorContent(cached);
      setSelectedTextFileReadyPath(selectedFile);
      return () => {
        cancelled = true;
      };
    }

    setSelectedTextFileReadyPath(null);
    readFile(activeProjectId, selectedFile)
      .then((result) => {
        if (!cancelled) {
          setEditorContent(result.content);
          setSelectedTextFileReadyPath(selectedFile);
          onTextFileLoaded?.(selectedFile, result.content);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setToast({ type: "error", message: String(error) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeProjectId,
    getCachedTextContent,
    onTextFileLoaded,
    selectedFile,
    setEditorContent,
    setSelectedTextFileReadyPath,
    setToast,
  ]);

  useEffect(() => {
    if (!activeProjectId || !selectedFile || !isPdfPath(selectedFile)) {
      selectedFilePdfUrlRef.current = null;
      setSelectedFilePdfUrl(null);
      return;
    }
    const nextUrl = buildWorkspacePreviewUrl(activeProjectId, selectedFile, `${page}-${Date.now()}`);
    selectedFilePdfUrlRef.current = nextUrl;
    setSelectedFilePdfUrl(nextUrl);
  }, [activeProjectId, page, selectedFile, setSelectedFilePdfUrl]);

  useEffect(() => {
    const imageTarget =
      previewOverridePath && isImagePath(previewOverridePath)
        ? previewOverridePath
        : (selectedFile && isImagePath(selectedFile) ? selectedFile : null);

    if (!activeProjectId || !imageTarget) {
      selectedImageUrlRef.current = null;
      setSelectedImagePreviewUrl(null);
      return;
    }
    const nextUrl = buildWorkspaceResourceUrl(activeProjectId, imageTarget);
    selectedImageUrlRef.current = nextUrl;
    setSelectedImagePreviewUrl(nextUrl);
  }, [activeProjectId, previewOverridePath, selectedFile, setSelectedImagePreviewUrl]);
}
