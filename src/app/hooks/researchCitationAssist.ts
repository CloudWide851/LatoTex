export type CitationInsertTarget = {
  getSelection?: () => {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null;
  executeEdits?: (
    source: string,
    edits: Array<{
      range: {
        startLineNumber: number;
        startColumn: number;
        endLineNumber: number;
        endColumn: number;
      };
      text: string;
      forceMoveMarkers?: boolean;
    }>,
  ) => void;
  focus?: () => void;
};

export function sanitizeCitationKey(value: string): string {
  return value.trim().replace(/^[@\\{\s]+|[}\s]+$/g, "");
}

export function isSafeCitationKey(value: string): boolean {
  return /^[A-Za-z0-9_:.+/-]{1,160}$/.test(sanitizeCitationKey(value));
}

export function buildCitationCommand(citationKey: string): string {
  const key = sanitizeCitationKey(citationKey);
  if (!isSafeCitationKey(key)) {
    throw new Error("research.citation.invalidKey");
  }
  return `\\cite{${key}}`;
}

export function insertCitationAtEditorSelection(
  editor: CitationInsertTarget | null,
  citationKey: string,
): boolean {
  const selection = editor?.getSelection?.();
  if (!editor?.executeEdits || !selection) {
    return false;
  }
  editor.executeEdits("latotex-research-citation", [{
    range: selection,
    text: buildCitationCommand(citationKey),
    forceMoveMarkers: true,
  }]);
  editor.focus?.();
  return true;
}
