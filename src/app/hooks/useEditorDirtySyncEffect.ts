import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { isPdfPath } from "../../shared/utils/fileKind";

export function useEditorDirtySyncEffect(params: {
  selectedFile: string | null;
  editorContent: string;
  savedContentByPathRef: MutableRefObject<Record<string, string>>;
  workingContentByPathRef: MutableRefObject<Record<string, string>>;
  setDirtyByPath: Dispatch<SetStateAction<Record<string, boolean>>>;
}) {
  const {
    selectedFile,
    editorContent,
    savedContentByPathRef,
    workingContentByPathRef,
    setDirtyByPath,
  } = params;

  useEffect(() => {
    if (!selectedFile || isPdfPath(selectedFile)) {
      return;
    }
    workingContentByPathRef.current[selectedFile] = editorContent;
    const saved = savedContentByPathRef.current[selectedFile];
    if (typeof saved !== "string") {
      return;
    }
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
  }, [editorContent, savedContentByPathRef, selectedFile, setDirtyByPath, workingContentByPathRef]);
}
