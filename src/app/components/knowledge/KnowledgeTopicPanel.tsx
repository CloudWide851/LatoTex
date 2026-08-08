import { Eye, EyeOff, Merge, Pencil, Pin } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  listKnowledgeTopics,
  mutateKnowledgeTopic,
} from "../../../shared/api/knowledge";
import type { KnowledgeTopic } from "../../../shared/types/app";
import { requestAppTextInput } from "../../dialog/appDialogBridge";
import { knowledgeFailureMessage } from "../../hooks/knowledgeMutationApproval";

type TranslationFn = (key: any) => string;

export function KnowledgeTopicPanel(props: {
  projectId: string;
  refreshToken: string;
  onChanged: () => void;
  t: TranslationFn;
}) {
  const [topics, setTopics] = useState<KnowledgeTopic[]>([]);
  const [busyTopicId, setBusyTopicId] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const visibleTopics = useMemo(() => topics.slice(0, 80), [topics]);

  useEffect(() => {
    let disposed = false;
    listKnowledgeTopics(props.projectId)
      .then((result) => {
        if (!disposed) {
          setTopics(result);
          setMergeTarget(result.find((topic) => !topic.hidden)?.topicId ?? "");
        }
      })
      .catch((error) => {
        if (!disposed) {
          setMessage(knowledgeFailureMessage(error, props.t));
        }
      });
    return () => {
      disposed = true;
    };
  }, [props.projectId, props.refreshToken, props.t]);

  const mutate = async (
    topic: KnowledgeTopic,
    action: "rename" | "hide" | "unhide" | "promote" | "merge",
  ) => {
    const label = action === "rename"
      ? (await requestAppTextInput({
          title: props.t("knowledge.topic.renamePrompt"),
          label: props.t("knowledge.topic.rename"),
          initialValue: topic.label,
          required: true,
        }))?.trim()
      : undefined;
    if (action === "rename" && !label) {
      return;
    }
    if (action === "merge" && (!mergeTarget || mergeTarget === topic.topicId)) {
      setMessage(props.t("knowledge.topic.mergeInvalid"));
      return;
    }
    setBusyTopicId(topic.topicId);
    setMessage(null);
    try {
      await mutateKnowledgeTopic({
        projectId: props.projectId,
        topicId: topic.topicId,
        action,
        label,
        targetTopicId: action === "merge" ? mergeTarget : undefined,
      });
      const next = await listKnowledgeTopics(props.projectId);
      setTopics(next);
      props.onChanged();
    } catch (error) {
      setMessage(knowledgeFailureMessage(error, props.t));
    } finally {
      setBusyTopicId(null);
    }
  };

  return (
    <section className="grid gap-2" aria-label={props.t("knowledge.topics")}>
      <div className="flex items-center gap-2">
        <strong className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {props.t("knowledge.topics")}
        </strong>
        <select
          value={mergeTarget}
          onChange={(event) => setMergeTarget(event.target.value)}
          aria-label={props.t("knowledge.topic.mergeTarget")}
          className="ml-auto h-7 max-w-40 rounded border border-[color:var(--editor-widget-border)] bg-transparent px-2 text-[11px]"
        >
          {topics.filter((topic) => !topic.hidden).map((topic) => (
            <option key={topic.topicId} value={topic.topicId}>{topic.label}</option>
          ))}
        </select>
      </div>
      {message ? <p className="text-[11px] text-amber-700" role="status">{message}</p> : null}
      {visibleTopics.length === 0 ? (
        <p className="text-xs text-slate-500">{props.t("knowledge.topic.empty")}</p>
      ) : (
        <div className="flex max-h-36 flex-wrap gap-1.5 overflow-auto">
          {visibleTopics.map((topic) => (
            <div
              key={topic.topicId}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/60 py-0.5 pl-2 pr-1 text-[11px]"
            >
              <span className={topic.hidden ? "text-slate-400 line-through" : "text-slate-700"}>
                {topic.label} · {topic.linkCount}
              </span>
              {[
                {
                  action: "rename" as const,
                  icon: Pencil,
                  label: props.t("knowledge.topic.rename"),
                },
                {
                  action: topic.hidden ? "unhide" as const : "hide" as const,
                  icon: topic.hidden ? Eye : EyeOff,
                  label: props.t(topic.hidden ? "knowledge.topic.unhide" : "knowledge.topic.hide"),
                },
                {
                  action: "promote" as const,
                  icon: Pin,
                  label: props.t("knowledge.topic.promote"),
                },
                {
                  action: "merge" as const,
                  icon: Merge,
                  label: props.t("knowledge.topic.merge"),
                },
              ].map(({ action, icon: Icon, label }) => (
                <button
                  key={action}
                  type="button"
                  disabled={busyTopicId === topic.topicId}
                  className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-accent)] disabled:opacity-40"
                  title={label}
                  aria-label={`${label}: ${topic.label}`}
                  onClick={() => void mutate(topic, action)}
                >
                  <Icon className="h-3 w-3" />
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
