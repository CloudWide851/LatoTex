import type { KnowledgeDocumentFocusRequest } from "../../../shared/types/app";
import { InfoHint } from "../../../components/ui/info-hint";
import { formatKnowledgeAnchor } from "./knowledgeDocumentFocus";

type TranslationFn = (key: any) => string;

export function KnowledgeFocusNotice(props: {
  request: KnowledgeDocumentFocusRequest | null;
  t: TranslationFn;
}) {
  const { request, t } = props;
  if (!request) {
    return null;
  }
  const anchor = formatKnowledgeAnchor(request.anchor) || t("knowledge.focusUnavailable");
  const content = [
    t("knowledge.focusUnavailable"),
    formatKnowledgeAnchor(request.anchor),
    request.snippet?.trim(),
  ].filter(Boolean).join("\n\n");
  return (
    <div className="flex min-w-0 items-center gap-1.5 border-b border-[color:var(--editor-widget-border)] px-3 py-1.5 text-[11px] text-[color:var(--app-muted)]">
      <span className="shrink-0 font-medium">{t("knowledge.focusContext")}</span>
      <span className="min-w-0 flex-1 truncate">{anchor}</span>
      <InfoHint content={content} label={t("knowledge.focusContext")} />
    </div>
  );
}
