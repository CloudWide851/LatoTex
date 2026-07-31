import { useEffect, useRef, useState } from "react";
import {
  getKnowledgeEmbeddingJobStatus,
  getKnowledgeEmbeddingStatus,
  pauseKnowledgeEmbeddings,
  rebuildKnowledgeEmbeddings,
  resumeKnowledgeEmbeddings,
} from "../../../shared/api/knowledge";
import type {
  EmbeddingRuntimeStatus,
  KnowledgeEmbeddingJobStatus,
} from "../../../shared/types/app";
import { knowledgeFailureMessage } from "../../hooks/knowledgeMutationApproval";
import { recordKnowledgeRuntimeMetric } from "./knowledgeRuntimePerformance";

type TranslationFn = (key: any) => string;

export function KnowledgeEmbeddingBanner(props: {
  projectId: string;
  message: string | null;
  status: EmbeddingRuntimeStatus | null;
  reminderEnabled: boolean;
  onStatusChange: (status: EmbeddingRuntimeStatus | null) => void;
  onOpenPlugins: () => void;
  t: TranslationFn;
}) {
  const [job, setJob] = useState<KnowledgeEmbeddingJobStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const throughputSampleRef = useRef<{ processed: number; at: number } | null>(null);

  useEffect(() => {
    let disposed = false;
    Promise.all([
      getKnowledgeEmbeddingStatus(props.projectId),
      getKnowledgeEmbeddingJobStatus(props.projectId),
    ])
      .then(([status, nextJob]) => {
        if (!disposed) {
          props.onStatusChange(status);
          setJob(nextJob);
        }
      })
      .catch(() => {
        if (!disposed) {
          props.onStatusChange(null);
        }
      });
    return () => {
      disposed = true;
    };
  }, [props.onStatusChange, props.projectId]);

  useEffect(() => {
    if (!job || !["queued", "indexing"].includes(job.state)) {
      return;
    }
    let disposed = false;
    const poll = window.setInterval(() => {
      getKnowledgeEmbeddingJobStatus(props.projectId)
        .then(async (nextJob) => {
          if (disposed) {
            return;
          }
          const sampledAt = performance.now();
          const previous = throughputSampleRef.current;
          if (previous && nextJob.processed > previous.processed && sampledAt > previous.at) {
            const chunksPerSecond = (
              (nextJob.processed - previous.processed) * 1_000
            ) / (sampledAt - previous.at);
            recordKnowledgeRuntimeMetric(
              "index_throughput",
              chunksPerSecond,
              nextJob.processed,
            );
          }
          throughputSampleRef.current = {
            processed: nextJob.processed,
            at: sampledAt,
          };
          setJob(nextJob);
          if (["ready", "failed", "paused"].includes(nextJob.state)) {
            props.onStatusChange(await getKnowledgeEmbeddingStatus(props.projectId));
          }
        })
        .catch(() => undefined);
    }, 1_000);
    return () => {
      disposed = true;
      window.clearInterval(poll);
    };
  }, [job, props.onStatusChange, props.projectId]);

  const run = async () => {
    if (!props.status?.installed) {
      props.onOpenPlugins();
      return;
    }
    setBusy(true);
    setLocalMessage(null);
    try {
      const next = job?.state === "paused"
        ? await resumeKnowledgeEmbeddings(props.projectId)
        : job && ["queued", "indexing"].includes(job.state)
          ? await pauseKnowledgeEmbeddings(props.projectId)
          : await rebuildKnowledgeEmbeddings(props.projectId);
      setJob(next);
    } catch (error) {
      setLocalMessage(knowledgeFailureMessage(error, props.t));
    } finally {
      setBusy(false);
    }
  };

  const jobActive = Boolean(job && ["queued", "indexing", "paused", "failed"].includes(job.state));
  if (!props.status && !props.message && !localMessage) {
    return null;
  }
  if (
    !props.reminderEnabled
    && !props.message
    && !localMessage
    && !props.status?.installed
    && !jobActive
  ) {
    return null;
  }
  if (!props.message && !localMessage && props.status?.available && !jobActive) {
    return null;
  }
  const actionLabel = !props.status?.installed
    ? props.t("knowledge.installModel")
    : job?.state === "paused"
      ? props.t("knowledge.embedding.resume")
      : job && ["queued", "indexing"].includes(job.state)
        ? props.t("knowledge.embedding.pause")
        : props.t("knowledge.embedding.rebuild");
  const statusMessage = job && ["queued", "indexing"].includes(job.state)
    ? `${props.t("knowledge.embedding.indexing")} ${job.processed}/${job.total}`
    : job?.state === "paused"
      ? props.t("knowledge.embedding.paused")
      : job?.state === "failed"
        ? props.t("knowledge.embedding.failed")
        : props.t("knowledge.semanticUnavailable");
  return (
    <div
      className="flex items-center gap-2 border-b border-[color:var(--editor-widget-border)] bg-amber-50 px-3 py-2 text-[11px] text-amber-800"
      role="status"
    >
      <span className="min-w-0 flex-1 truncate">
        {props.message ?? localMessage ?? statusMessage}
      </span>
      <button
        type="button"
        className="shrink-0 underline disabled:opacity-50"
        disabled={busy}
        onClick={() => void run()}
      >
        {actionLabel}
      </button>
    </div>
  );
}
