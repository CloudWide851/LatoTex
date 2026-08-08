import { CheckCircle2, FileSearch2, ShieldQuestion } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import type { MessageKey } from "../../../i18n/messages/en-US/index";
import {
  assessResearchClaim,
  listResearchClaimAssessments,
  listResearchEvidence,
} from "../../../shared/api/researchAgent";
import type {
  ClaimEvidenceAssessment,
  EvidencePacket,
} from "../../../shared/types/researchAgent";

type TranslationFn = (key: MessageKey) => string;

function evidenceLocator(packet: EvidencePacket): string {
  const parts = [
    packet.locator.page ? `p. ${packet.locator.page}` : "",
    packet.locator.section ?? "",
    packet.locator.paragraph ?? "",
  ].filter(Boolean);
  return parts.join(" · ");
}

export function ResearchEvidenceLedger(props: {
  projectId: string;
  taskId: string;
  refreshToken: number;
  t: TranslationFn;
}) {
  const { projectId, taskId, refreshToken, t } = props;
  const [evidence, setEvidence] = useState<EvidencePacket[]>([]);
  const [assessments, setAssessments] = useState<ClaimEvidenceAssessment[]>([]);
  const [claim, setClaim] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    const [nextEvidence, nextAssessments] = await Promise.all([
      listResearchEvidence(projectId, taskId),
      listResearchClaimAssessments(projectId, taskId),
    ]);
    setEvidence(nextEvidence);
    setAssessments(nextAssessments);
  }, [projectId, taskId]);

  useEffect(() => {
    setEvidence([]);
    setAssessments([]);
    setError(false);
    void refresh().catch(() => setError(true));
  }, [refresh, refreshToken]);

  const verifyClaim = async () => {
    if (!claim.trim() || evidence.length === 0 || busy) return;
    setBusy(true);
    setError(false);
    try {
      await assessResearchClaim({
        projectId,
        taskId,
        claim: claim.trim(),
        evidenceIds: evidence.map((packet) => packet.id),
      });
      setClaim("");
      await refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="app-material-panel flex min-h-0 flex-col overflow-hidden rounded-lg border">
      <header className="border-b px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-xs font-semibold text-[color:var(--app-fg)]">
            <FileSearch2 className="h-3.5 w-3.5 text-[color:var(--app-accent)]" />
            {t("research.workbench.evidenceTitle")}
          </h2>
          <span className="text-[10px] text-[color:var(--app-muted)]">
            {evidence.length} {t("research.workbench.evidenceCount")}
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-4 text-[color:var(--app-muted)]">
          {t("research.workbench.evidenceHint")}
        </p>
      </header>

      <div className="library-scrollbar min-h-0 flex-1 overflow-auto">
        {error ? (
          <p className="app-status-danger m-3 rounded border px-2 py-1.5 text-[11px]" role="alert">
            {t("research.workbench.error")}
          </p>
        ) : null}
        {evidence.length === 0 ? (
          <div className="grid min-h-32 place-items-center px-4 text-center text-[11px] leading-4 text-[color:var(--app-muted)]">
            {t("research.workbench.evidenceEmpty")}
          </div>
        ) : (
          <div className="divide-y">
            {evidence.map((packet) => (
              <article key={packet.id} className="px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-xs font-medium leading-4 text-[color:var(--app-fg)]">{packet.title}</h3>
                  <span className={`shrink-0 rounded border px-1 py-0.5 text-[9px] ${packet.retractionStatus === "retracted" ? "app-status-danger" : packet.retractionStatus === "corrected" ? "app-status-warning" : "app-status-success"}`}>
                    {t(`research.workbench.retraction.${packet.retractionStatus}`)}
                  </span>
                </div>
                <blockquote className="mt-2 border-l-2 border-[color:var(--app-accent)] pl-2 text-[11px] leading-4 text-[color:var(--app-muted)]">
                  {packet.excerpt}
                </blockquote>
                <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[9px] text-[color:var(--app-muted)]">
                  <span>{packet.source}</span>
                  {packet.doi ? <span>DOI {packet.doi}</span> : null}
                  {evidenceLocator(packet) ? <span>{evidenceLocator(packet)}</span> : null}
                  <span title={packet.contentHash}>#{packet.contentHash.slice(0, 10)}</span>
                </div>
              </article>
            ))}
          </div>
        )}

        {assessments.length > 0 ? (
          <section className="border-t px-3 py-3">
            <h3 className="text-[11px] font-semibold text-[color:var(--app-fg)]">
              {t("research.workbench.assessments")}
            </h3>
            <div className="mt-2 space-y-2">
              {assessments.map((assessment) => (
                <article key={assessment.id} className="app-material-inset rounded-md border px-2 py-2 text-[11px]">
                  <div className="flex items-start gap-2">
                    {assessment.status === "supported" ? (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--app-status-success)]" />
                    ) : (
                      <ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--app-status-warning)]" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-[color:var(--app-fg)]">{assessment.claim}</p>
                      <p className="mt-1 text-[color:var(--app-muted)]">
                        {t(`research.workbench.assessment.${assessment.status}`)} · {assessment.rationale}
                      </p>
                      {assessment.requiresUnconfirmedLabel ? (
                        <p className="mt-1 font-medium text-[color:var(--app-status-warning)]">
                          {t("research.workbench.unconfirmed")}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <div className="border-t p-3">
        <label className="grid gap-1 text-[11px] text-[color:var(--app-muted)]">
          <span>{t("research.workbench.claimLabel")}</span>
          <textarea
            value={claim}
            disabled={busy || evidence.length === 0}
            onChange={(event) => setClaim(event.target.value)}
            className="app-material-inset min-h-16 resize-none rounded-md border px-2 py-1.5 text-xs text-[color:var(--app-fg)] outline-none focus:border-[color:var(--app-accent)]"
            placeholder={t("research.workbench.claimPlaceholder")}
          />
        </label>
        <Button className="mt-2 w-full" size="sm" disabled={busy || evidence.length === 0 || !claim.trim()} onClick={() => void verifyClaim()}>
          <ShieldQuestion className="h-3.5 w-3.5" />
          {t("research.workbench.verifyClaim")}
        </Button>
      </div>
    </aside>
  );
}
