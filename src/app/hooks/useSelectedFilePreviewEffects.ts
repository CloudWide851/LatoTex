import { useEffect, useRef } from "react";
import { readFile, readFileBinary } from "../../shared/api/desktop";
import { isExcelPath, isImagePath, isPdfPath } from "../../shared/utils/fileKind";

type ToastSetter = (value: { type: "info" | "error"; message: string } | null) => void;

function mimeFromImagePath(path: string): string {
  const lower = path.trim().toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".bmp")) {
    return "image/bmp";
  }
  return "application/octet-stream";
}

export function useSelectedFilePreviewEffects(params: {
  activeProjectId: string | null;
  selectedFile: string | null;
  previewOverridePath: string | null;
  setEditorContent: (value: string) => void;
  setSelectedFilePdfUrl: (value: string | null) => void;
  setSelectedImagePreviewUrl: (value: string | null) => void;
  setToast: ToastSetter;
  getCachedTextContent?: (relativePath: string) => string | null;
  onTextFileLoaded?: (relativePath: string, content: string) => void;
}) {
  const {
    activeProjectId,
    selectedFile,
    previewOverridePath,
    setEditorContent,
    setSelectedFilePdfUrl,
    setSelectedImagePreviewUrl,
    setToast,
    getCachedTextContent,
    onTextFileLoaded,
  } = params;

  const selectedFilePdfObjectUrlRef = useRef<string | null>(null);
  const selectedImageObjectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeProjectId || !selectedFile) {
      setEditorContent("");
      return;
    }
    if (isPdfPath(selectedFile) || isExcelPath(selectedFile) || isImagePath(selectedFile)) {
      setEditorContent("");
      return;
    }

    let cancelled = false;
    const cached = getCachedTextContent?.(selectedFile);
    if (typeof cached === "string") {
      setEditorContent(cached);
      return () => {
        cancelled = true;
      };
    }

    readFile(activeProjectId, selectedFile)
      .then((result) => {
        if (!cancelled) {
          setEditorContent(result.content);
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
    setToast,
  ]);

  useEffect(() => {
    if (!activeProjectId || !selectedFile || !isPdfPath(selectedFile)) {
      if (selectedFilePdfObjectUrlRef.current) {
        URL.revokeObjectURL(selectedFilePdfObjectUrlRef.current);
        selectedFilePdfObjectUrlRef.current = null;
      }
      setSelectedFilePdfUrl(null);
      return;
    }

    let cancelled = false;
    readFileBinary(activeProjectId, selectedFile)
      .then((result) => {
        if (cancelled) {
          return;
        }
        const url = URL.createObjectURL(
          new Blob([Uint8Array.from(result.bytes)], { type: "application/pdf" }),
        );
        const previous = selectedFilePdfObjectUrlRef.current;
        if (previous && previous !== url) {
          URL.revokeObjectURL(previous);
        }
        selectedFilePdfObjectUrlRef.current = url;
        setSelectedFilePdfUrl(url);
      })
      .catch((error) => {
        if (!cancelled) {
          setToast({ type: "error", message: String(error) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeProjectId, selectedFile, setSelectedFilePdfUrl, setToast]);

  useEffect(() => {
    const imageTarget =
      previewOverridePath && isImagePath(previewOverridePath)
        ? previewOverridePath
        : (selectedFile && isImagePath(selectedFile) ? selectedFile : null);

    if (!activeProjectId || !imageTarget) {
      if (selectedImageObjectUrlRef.current) {
        URL.revokeObjectURL(selectedImageObjectUrlRef.current);
        selectedImageObjectUrlRef.current = null;
      }
      setSelectedImagePreviewUrl(null);
      return;
    }

    let cancelled = false;
    readFileBinary(activeProjectId, imageTarget)
      .then((result) => {
        if (cancelled) {
          return;
        }
        const url = URL.createObjectURL(
          new Blob([Uint8Array.from(result.bytes)], { type: mimeFromImagePath(imageTarget) }),
        );
        const previous = selectedImageObjectUrlRef.current;
        if (previous && previous !== url) {
          URL.revokeObjectURL(previous);
        }
        selectedImageObjectUrlRef.current = url;
        setSelectedImagePreviewUrl(url);
      })
      .catch((error) => {
        if (!cancelled) {
          setToast({ type: "error", message: String(error) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeProjectId, previewOverridePath, selectedFile, setSelectedImagePreviewUrl, setToast]);

  useEffect(() => {
    return () => {
      if (selectedFilePdfObjectUrlRef.current) {
        URL.revokeObjectURL(selectedFilePdfObjectUrlRef.current);
        selectedFilePdfObjectUrlRef.current = null;
      }
      if (selectedImageObjectUrlRef.current) {
        URL.revokeObjectURL(selectedImageObjectUrlRef.current);
        selectedImageObjectUrlRef.current = null;
      }
    };
  }, []);
}
