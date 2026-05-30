import { useEffect, useRef } from "react";
import { runtimeLogWrite } from "../../shared/api/runtime";
import { readFile } from "../../shared/api/workspace";
import { isDocxPath, isExcelPath, isImagePath, isPdfPath } from "../../shared/utils/fileKind";
import { buildWorkspaceResourceUrl, buildWorkspacePreviewUrl } from "../../shared/utils/workspaceResource";

type ToastSetter = (value: { type: "info" | "error"; message: string } | null) => void;

export function useSelectedFilePreviewEffects(params: {
  activeProjectId: string | null;
  selectedFile: string | null;
  fileSet: Set<string>;
  page: string;
  previewOverridePath: string | null;
  setEditorContent: (value: string) => void;
  setSelectedFilePdfUrl: (value: string | null) => void;
  setSelectedImagePreviewUrl: (value: string | null) => void;
  setSelectedTextFileReadyPath: (value: string | null) => void;
  setToast: ToastSetter;
  t: (key: any) => string;
  getCachedTextContent?: (relativePath: string) => string | null;
  onTextFileLoaded?: (relativePath: string, content: string) => void;
}) {
  const {
    activeProjectId,
    selectedFile,
    fileSet,
    page,
    previewOverridePath,
    setEditorContent,
    setSelectedFilePdfUrl,
    setSelectedImagePreviewUrl,
    setSelectedTextFileReadyPath,
    setToast,
    t,
    getCachedTextContent,
    onTextFileLoaded,
  } = params;

  const selectedFilePdfUrlRef = useRef<string | null>(null);
  const selectedImageUrlRef = useRef<string | null>(null);
  const textLoadSeqRef = useRef(0);

  const mapReadErrorMessage = (error: unknown): string => {
    const message = String(error ?? "").trim();
    if (message === "workspace.file_read.not_file") {
      return t("toast.fileNotReadable");
    }
    if (message === "workspace.file_read.access_denied") {
      return t("toast.fileAccessDenied");
    }
    if (message === "workspace.file_read.invalid_utf8") {
      return t("toast.fileInvalidTextEncoding");
    }
    return message;
  };

  useEffect(() => {
    const seq = textLoadSeqRef.current + 1;
    textLoadSeqRef.current = seq;
    if (!activeProjectId || !selectedFile) {
      setSelectedTextFileReadyPath(null);
      setEditorContent("");
      return;
    }
    if (!fileSet.has(selectedFile)) {
      setSelectedTextFileReadyPath(null);
      setEditorContent("");
      return;
    }
    if (isPdfPath(selectedFile) || isExcelPath(selectedFile) || isImagePath(selectedFile) || isDocxPath(selectedFile)) {
      setSelectedTextFileReadyPath(null);
      setEditorContent("");
      return;
    }

    let cancelled = false;
    const startedAt = Date.now();
    const cached = getCachedTextContent?.(selectedFile);
    if (typeof cached === "string") {
      setEditorContent(cached);
      setSelectedTextFileReadyPath(selectedFile);
      void runtimeLogWrite(
        "INFO",
        `editor_file_load.cache_hit: project=${activeProjectId}, path=${selectedFile}, chars=${cached.length}`,
      ).catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }

    setSelectedTextFileReadyPath(null);
    void runtimeLogWrite(
      "INFO",
      `editor_file_load.start: project=${activeProjectId}, path=${selectedFile}`,
    ).catch(() => undefined);
    readFile(activeProjectId, selectedFile)
      .then((result) => {
        if (!cancelled && textLoadSeqRef.current === seq) {
          setEditorContent(result.content);
          setSelectedTextFileReadyPath(selectedFile);
          onTextFileLoaded?.(selectedFile, result.content);
          void runtimeLogWrite(
            "INFO",
            `editor_file_load.success: project=${activeProjectId}, path=${selectedFile}, chars=${result.content.length}, durationMs=${Date.now() - startedAt}`,
          ).catch(() => undefined);
        }
      })
      .catch((error) => {
        if (!cancelled && textLoadSeqRef.current === seq) {
          setSelectedTextFileReadyPath(null);
          setEditorContent("");
          setToast({ type: "error", message: mapReadErrorMessage(error) });
          void runtimeLogWrite(
            "ERROR",
            `editor_file_load.error: project=${activeProjectId}, path=${selectedFile}, durationMs=${Date.now() - startedAt}, reason=${String(error)}`,
          ).catch(() => undefined);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeProjectId,
    fileSet,
    getCachedTextContent,
    onTextFileLoaded,
    selectedFile,
    setEditorContent,
    setSelectedTextFileReadyPath,
    setToast,
    t,
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
