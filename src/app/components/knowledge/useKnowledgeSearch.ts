import { useEffect, useRef, useState } from "react";
import {
  cancelKnowledgeSearch,
  searchKnowledge,
} from "../../../shared/api/knowledge";
import type {
  EmbeddingRuntimeStatus,
  KnowledgeSearchHit,
  KnowledgeSearchResponse,
} from "../../../shared/types/app";
import { knowledgeFailureMessage } from "../../hooks/knowledgeMutationApproval";
import { beginKnowledgeSearchTelemetry } from "./knowledgeSearchPerformance";

type TranslationFn = (key: any) => string;
type KnowledgeSearchScope = "current" | "all";
type KnowledgeSearchPhase = "lexical" | "hybrid";

let knowledgeSearchSequence = 0;

function nextKnowledgeSearchRunId() {
  knowledgeSearchSequence = (knowledgeSearchSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `knowledge-${Date.now().toString(36)}-${knowledgeSearchSequence.toString(36)}`;
}

function isCancelledFailure(error: unknown) {
  return String(error).includes("knowledge.search.cancelled");
}

export function useKnowledgeSearch(params: {
  projectId: string;
  projectIds: string[] | null;
  scope: KnowledgeSearchScope;
  query: string;
  deep: boolean;
  onAcceptedResponse: (
    response: KnowledgeSearchResponse,
    phase: KnowledgeSearchPhase,
  ) => void;
  onStart: () => void;
  t: TranslationFn;
}) {
  const {
    deep,
    onAcceptedResponse,
    onStart,
    projectId,
    projectIds,
    query,
    scope,
    t,
  } = params;
  const activeRunRef = useRef<string | null>(null);
  const acceptedResponseRef = useRef(onAcceptedResponse);
  const onStartRef = useRef(onStart);
  const translationRef = useRef(t);
  const [hits, setHits] = useState<KnowledgeSearchHit[]>([]);
  const [embedding, setEmbedding] = useState<EmbeddingRuntimeStatus | null>(null);
  const [searching, setSearching] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    acceptedResponseRef.current = onAcceptedResponse;
  }, [onAcceptedResponse]);
  useEffect(() => {
    onStartRef.current = onStart;
  }, [onStart]);
  useEffect(() => {
    translationRef.current = t;
  }, [t]);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) {
      activeRunRef.current = null;
      setHits([]);
      setEmbedding(null);
      setSearching(false);
      setErrorMessage(null);
      return;
    }
    if (scope === "all" && !projectIds) {
      setSearching(false);
      return;
    }

    const runId = nextKnowledgeSearchRunId();
    activeRunRef.current = runId;
    setSearching(true);
    setErrorMessage(null);
    onStartRef.current();
    let disposed = false;
    let telemetry: ReturnType<typeof beginKnowledgeSearchTelemetry> | null = null;
    const isCurrent = () => !disposed && activeRunRef.current === runId;
    const timer = window.setTimeout(() => {
      telemetry = beginKnowledgeSearchTelemetry(runId);
      void (async () => {
        let lexicalAccepted = false;
        try {
          const baseInput = {
            projectId,
            projectIds: scope === "all" ? projectIds ?? undefined : undefined,
            query: normalized,
            limit: 100,
            runId,
          };
          const lexical = await searchKnowledge({
            ...baseInput,
            deep: false,
            semantic: false,
          });
          if (!isCurrent()) {
            return;
          }
          lexicalAccepted = true;
          setHits(lexical.hits);
          setEmbedding(lexical.embedding);
          acceptedResponseRef.current(lexical, "lexical");
          if (lexical.hits.length > 0) {
            telemetry?.record("first_result", lexical.hits.length);
          }
          telemetry?.record("lexical_complete", lexical.hits.length);

          if (!deep && !lexical.embedding.available) {
            return;
          }
          const hybrid = await searchKnowledge({
            ...baseInput,
            deep,
            semantic: true,
          });
          if (!isCurrent()) {
            return;
          }
          setHits(hybrid.hits);
          setEmbedding(hybrid.embedding);
          acceptedResponseRef.current(hybrid, "hybrid");
          if (lexical.hits.length === 0 && hybrid.hits.length > 0) {
            telemetry?.record("first_result", hybrid.hits.length);
          }
          telemetry?.record("hybrid_complete", hybrid.hits.length);
        } catch (error) {
          if (!isCurrent() || isCancelledFailure(error)) {
            return;
          }
          setErrorMessage(knowledgeFailureMessage(error, translationRef.current));
          if (!lexicalAccepted) {
            setHits([]);
          }
        } finally {
          if (isCurrent()) {
            setSearching(false);
          }
          telemetry?.dispose();
        }
      })();
    }, 180);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      if (activeRunRef.current === runId) {
        activeRunRef.current = null;
      }
      void cancelKnowledgeSearch(runId).catch(() => undefined);
      telemetry?.dispose();
    };
  }, [deep, projectId, projectIds, query, scope]);

  return {
    embedding,
    errorMessage,
    hits,
    searching,
    setEmbeddingStatus: setEmbedding,
  };
}
