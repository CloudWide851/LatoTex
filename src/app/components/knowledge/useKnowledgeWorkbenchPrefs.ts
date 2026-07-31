import { useCallback, useEffect, useRef, useState } from "react";
import { getSettings } from "../../../shared/api/settings";
import type { KnowledgeSearchScope } from "../../../shared/types/app";
import { normalizeKnowledgePrefs } from "../../settings/knowledgeSettings";

export function useKnowledgeWorkbenchPrefs() {
  const scopeTouchedRef = useRef(false);
  const [prefs, setPrefs] = useState(() => normalizeKnowledgePrefs(undefined));
  const [searchScope, setSearchScope] = useState<KnowledgeSearchScope>("current");

  useEffect(() => {
    let disposed = false;
    getSettings()
      .then((settings) => {
        if (disposed) {
          return;
        }
        const next = normalizeKnowledgePrefs(settings.uiPrefs);
        setPrefs(next);
        if (!scopeTouchedRef.current) {
          setSearchScope(next.defaultScope);
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, []);

  const selectSearchScope = useCallback((scope: KnowledgeSearchScope) => {
    scopeTouchedRef.current = true;
    setSearchScope(scope);
  }, []);

  return {
    knowledgePrefs: prefs,
    searchScope,
    selectSearchScope,
  };
}
