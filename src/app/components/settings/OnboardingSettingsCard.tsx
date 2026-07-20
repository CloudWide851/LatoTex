import { PlayCircle } from "lucide-react";
import { Button } from "../../../components/ui/button";
import type { MessageKey } from "../../../i18n/messages/en-US/index";
import type { AppSettings } from "../../../shared/types/app";
import { applyOnboardingEventToSettings, normalizeOnboardingState } from "../../onboarding/onboardingState";

type TranslationFn = (key: MessageKey) => string;

export function OnboardingSettingsCard(props: {
  activeProjectId: string | null;
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings | null>>;
  t: TranslationFn;
}) {
  const { activeProjectId, settings, setSettings, t } = props;
  const onboarding = normalizeOnboardingState(settings.uiPrefs?.onboarding);
  const activeProjectOnboarding = onboarding?.projectId === activeProjectId ? onboarding : undefined;
  const statusMessage = activeProjectOnboarding?.status === "active"
    ? t("settings.onboardingActive")
    : activeProjectOnboarding?.status === "completed"
      ? t("settings.onboardingCompleted")
      : t("settings.onboardingReady");

  return (
    <section className="app-material-inset rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-800">{t("settings.onboardingTitle")}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">{t("settings.onboardingDescription")}</p>
          <p className="mt-1 text-xs text-[color:var(--app-muted)]" role="status">
            {activeProjectId ? statusMessage : t("settings.onboardingNoProject")}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!activeProjectId}
          onClick={() => {
            if (!activeProjectId) {
              return;
            }
            setSettings((current) => current
              ? applyOnboardingEventToSettings(current, {
                  type: "restart",
                  projectId: activeProjectId,
                })
              : current);
          }}
        >
          <PlayCircle className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("settings.onboardingReplay")}
        </Button>
      </div>
    </section>
  );
}
