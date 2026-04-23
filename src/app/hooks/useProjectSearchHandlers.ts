import { useCallback, useEffect, useRef } from "react";
import { projectSearchContent, projectSearchContentIncremental } from "../../shared/api/projects";
import type { ProjectSearchHit, ProjectSearchScope } from "../../shared/types/app";
import { loadChatStore, requestOpenChatSession, setActiveChatSessionInStore } from "./chatSessionStore";

function hitKey(hit: ProjectSearchHit): string {
  return [
    hit.matchKind,
    hit.relativePath ?? "",
    String(hit.lineNumber ?? 0),
    hit.sessionId ?? "",
    hit.title ?? "",
    hit.snippet,
  ].join("::");
}

function mergeHits(current: ProjectSearchHit[], next: ProjectSearchHit[]): ProjectSearchHit[] {
  const seen = new Set<string>();
  const merged: ProjectSearchHit[] = [];
  for (const hit of [...current, ...next]) {
    const key = hitKey(hit);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(hit);
  }
  return merged.slice(0, 180);
}

export function useProjectSearchHandlers(params: {
  activeProjectId: string | null;
  projectSearchQuery: string;
  setProjectSearchResults: (value: ProjectSearchHit[]) => void;
  setProjectSearchSearched: (value: boolean) => void;
  setProjectSearchBusy: (value: boolean) => void;
  setToast: (value: { type: "info" | "error"; message: string } | null) => void;
  setPage: (value: string) => void;
  setSelectedFile: (value: string | null) => void;
  setPendingRevealLine: (value: number | null) => void;
}) {
  const {
    activeProjectId,
    projectSearchQuery,
    setProjectSearchResults,
    setProjectSearchSearched,
    setProjectSearchBusy,
    setToast,
    setPage,
    setSelectedFile,
    setPendingRevealLine,
  } = params;
  const queryRef = useRef(projectSearchQuery);
  const projectIdRef = useRef(activeProjectId);
  const requestIdRef = useRef(0);

  useEffect(() => {
    queryRef.current = projectSearchQuery;
    requestIdRef.current += 1;
    setProjectSearchBusy(false);
  }, [projectSearchQuery, setProjectSearchBusy]);

  useEffect(() => {
    projectIdRef.current = activeProjectId;
    requestIdRef.current += 1;
  }, [activeProjectId]);

  const handleProjectSearch = useCallback(async (
    scopes: ProjectSearchScope[] = ["file_name", "file_content", "chat_session"],
  ) => {
    const projectId = activeProjectId;
    const query = projectSearchQuery.trim();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    const isCurrentRequest = () =>
      requestIdRef.current === requestId
      && projectIdRef.current === projectId
      && queryRef.current.trim() === query;

    if (!projectId || !query) {
      setProjectSearchResults([]);
      setProjectSearchSearched(true);
      setProjectSearchBusy(false);
      return;
    }

    const normalizedQuery = query.toLowerCase();
    let mergedHits: ProjectSearchHit[] = [];
    setProjectSearchBusy(true);
    setProjectSearchSearched(true);

    try {
      if (scopes.includes("chat_session")) {
        const chatHits = loadChatStore(projectId).sessions
          .filter((session) => session.title.trim().toLowerCase().includes(normalizedQuery))
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .slice(0, 40)
          .map((session) => ({
            relativePath: null,
            lineNumber: null,
            matchKind: "chat_session" as const,
            snippet: session.title,
            sessionId: session.id,
            title: session.title,
          }));
        if (!isCurrentRequest()) {
          return;
        }
        mergedHits = mergeHits(mergedHits, chatHits);
        setProjectSearchResults(mergedHits);
      }

      if (scopes.includes("file_name")) {
        const fileNameHits = await projectSearchContent(projectId, query, 60, ["file_name"]);
        if (!isCurrentRequest()) {
          return;
        }
        mergedHits = mergeHits(mergedHits, fileNameHits);
        setProjectSearchResults(mergedHits);
      }

      if (scopes.includes("file_content")) {
        let cursor: string | null = null;
        let done = false;
        while (!done) {
          const batch = await projectSearchContentIncremental({
            projectId,
            query,
            limit: 28,
            scope: "file_content",
            cursor,
          });
          if (!isCurrentRequest()) {
            return;
          }
          mergedHits = mergeHits(mergedHits, batch.hits);
          setProjectSearchResults(mergedHits);
          cursor = batch.nextCursor ?? null;
          done = batch.done || !cursor;
          if (!done) {
            await new Promise((resolve) => window.setTimeout(resolve, 0));
          }
        }
      }
    } catch (error) {
      if (!isCurrentRequest()) {
        return;
      }
      setToast({ type: "error", message: String(error) });
      setProjectSearchResults([]);
    } finally {
      if (isCurrentRequest()) {
        setProjectSearchBusy(false);
      }
    }
  }, [
    activeProjectId,
    projectSearchQuery,
    setProjectSearchBusy,
    setProjectSearchResults,
    setProjectSearchSearched,
    setToast,
  ]);

  const handleProjectSearchSelect = useCallback((hit: ProjectSearchHit) => {
    if (hit.matchKind === "chat_session" && activeProjectId && hit.sessionId) {
      setActiveChatSessionInStore(activeProjectId, hit.sessionId);
      requestOpenChatSession({ projectId: activeProjectId, sessionId: hit.sessionId });
      return;
    }
    if (!hit.relativePath) {
      return;
    }
    setPage("latex");
    setSelectedFile(hit.relativePath);
    setPendingRevealLine(hit.matchKind === "file_content" ? (hit.lineNumber ?? null) : null);
  }, [activeProjectId, setPage, setPendingRevealLine, setSelectedFile]);

  return {
    handleProjectSearch,
    handleProjectSearchSelect,
  };
}
