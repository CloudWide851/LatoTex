import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { isPdfPath } from "../../shared/utils/fileKind";

export function useEditorDirtySyncEffect(params: {
  selectedFile: string | null;
  selectedTextFileReadyPath: string | null;
  editorContent: string;
  savedContentByPathRef: MutableRefObject<Record<string, string>>;
  workingContentByPathRef: MutableRefObject<Record<string, string>>;
  setDirtyByPath: Dispatch<SetStateAction<Record<string, boolean>>>;
}) {
  const {
    selectedFile,
    selectedTextFileReadyPath,
    editorContent,
    savedContentByPathRef,
    workingContentByPathRef,
    setDirtyByPath,
  } = params;

  useEffect(() => {
    if (!selectedFile || isPdfPath(selectedFile) || selectedTextFileReadyPath !== selectedFile) {
      return;
    }
    const saved = savedContentByPathRef.current[selectedFile];
    if (typeof saved !== "string") {
      if (editorContent.trim().length > 0) {
        workingContentByPathRef.current[selectedFile] = editorContent;
      }
      return;
    }
    workingContentByPathRef.current[selectedFile] = editorContent;
    const dirty = editorContent !== saved;
    setDirtyByPath((prev) => {
      const wasDirty = Boolean(prev[selectedFile]);
      if (dirty === wasDirty) {
        return prev;
      }
      const next = { ...prev };
      if (dirty) {
        next[selectedFile] = true;
      } else {
        delete next[selectedFile];
      }
      return next;
    });
  }, [editorContent, savedContentByPathRef, selectedFile, selectedTextFileReadyPath, setDirtyByPath, workingContentByPathRef]);
}
