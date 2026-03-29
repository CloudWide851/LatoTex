import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  LoaderCircle,
  RefreshCcw,
  Wrench,
} from "lucide-react";
import { deriveStartupProgress, type AppStartupStep } from "../hooks/startupState";

type TranslationFn = (key: any) => string;

function StepIcon(props: { status: AppStartupStep["status"] }) {
  const { status } = props;
  if (status === "ready") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  }
  if (status === "running") {
    return <LoaderCircle className="h-4 w-4 animate-spin text-primary-600" />;
  }
  if (status === "actionRequired" || status === "failed") {
    return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  }
  return <CircleDashed className="h-4 w-4 text-slate-400" />;
}

export function StartupOverlay(props: {
  startupState: {
    phase: "booting" | "warming" | "actionRequired" | "ready" | "failed";
    steps: AppStartupStep[];
    error: string | null;
    analysisEnvStatus: {
      exists: boolean;
      venvPath: string;
      managedRoot: string;
      lastError?: string | null;
    } | null;
  };
  onRetry: () => void;
  onChooseAnalysisEnvLocation: () => void;
  onPrepareAnalysisEnv: () => void;
  t: TranslationFn;
}) {
  const {
    startupState,
    onRetry,
    onChooseAnalysisEnvLocation,
    onPrepareAnalysisEnv,
    t,
  } = props;
  const progress = deriveStartupProgress(startupState.steps);
  const actionRequired = startupState.phase === "actionRequired";
  const failed = startupState.phase === "failed";
  const envStatus = startupState.analysisEnvStatus;
  const envPath = envStatus?.venvPath || envStatus?.managedRoot || "-";
  const prepareLabel = envStatus?.exists ? t("analysis.envPromptRepair") : t("analysis.envPromptCreate");

  if (startupState.phase === "ready") {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[460] flex items-center justify-center bg-slate-950/38 p-4 backdrop-blur-[2px] motion-overlay-enter">
      <section className="w-full max-w-xl rounded-[24px] border border-slate-200 bg-white/96 p-5 shadow-soft motion-card-pop motion-panel-glow">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary-700">
              <Wrench className="h-3.5 w-3.5" />
              {t("app.startup.title")}
            </div>
            <p className="mt-3 text-sm text-slate-600">
              {actionRequired
                ? t("app.startup.actionRequiredHint")
                : failed
                  ? t("app.startup.failedHint")
                  : t("app.startup.loadingHint")}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-2xl font-semibold tracking-tight text-slate-900">{progress}%</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{t("common.loading")}</div>
          </div>
        </div>

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all ${failed ? "bg-amber-500" : "bg-primary-600"}`}
            style={{ width: `${Math.max(progress, 4)}%` }}
          />
        </div>

        <div className="mt-4 max-h-[320px] space-y-2 overflow-auto pr-1">
          {startupState.steps.map((step) => (
            <div
              key={step.key}
              className={`rounded-xl border px-3 py-2 ${step.status === "running"
                ? "border-primary-200 bg-primary-50/70"
                : step.status === "actionRequired" || step.status === "failed"
                  ? "border-amber-200 bg-amber-50/70"
                  : step.status === "ready"
                    ? "border-emerald-200 bg-emerald-50/60"
                    : "border-slate-200 bg-slate-50/80"}`}
            >
              <div className="flex items-center gap-2">
                <StepIcon status={step.status} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-800">{t(step.labelKey)}</div>
                  {step.detail ? (
                    <div className="mt-0.5 break-all text-xs text-slate-500">{step.detail}</div>
                  ) : null}
                </div>
                {typeof step.progress === "number" ? (
                  <div className="shrink-0 text-xs tabular-nums text-slate-500">{Math.round(step.progress)}%</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {actionRequired && envStatus ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs text-amber-900">
            <div className="font-semibold text-amber-950">{t("analysis.envPromptTitle")}</div>
            <div className="mt-2 text-amber-900">{envStatus.exists ? t("analysis.envPromptRepairHint") : t("analysis.envPromptCreateHint")}</div>
            <div className="mt-3 rounded-xl border border-amber-200 bg-white/80 px-3 py-2 font-mono text-[11px] text-slate-700">
              {envPath}
            </div>
            {envStatus.lastError ? (
              <div className="mt-2 break-all text-[11px] text-amber-900">{envStatus.lastError}</div>
            ) : null}
          </div>
        ) : null}

        {failed && startupState.error ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs text-amber-900">
            {startupState.error}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {actionRequired ? (
            <>
              <button
                type="button"
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
                onClick={onRetry}
              >
                <RefreshCcw className="mr-1 inline h-3.5 w-3.5" />
                {t("app.startup.retry")}
              </button>
              <button
                type="button"
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
                onClick={onChooseAnalysisEnvLocation}
              >
                {t("analysis.envPromptChooseLocation")}
              </button>
              <button
                type="button"
                className="rounded-xl border border-primary-600 bg-primary-600 px-3 py-2 text-sm text-white transition hover:bg-primary-700"
                onClick={onPrepareAnalysisEnv}
              >
                {prepareLabel}
              </button>
            </>
          ) : failed ? (
            <button
              type="button"
              className="rounded-xl border border-primary-600 bg-primary-600 px-3 py-2 text-sm text-white transition hover:bg-primary-700"
              onClick={onRetry}
            >
              <RefreshCcw className="mr-1 inline h-3.5 w-3.5" />
              {t("app.startup.retry")}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
