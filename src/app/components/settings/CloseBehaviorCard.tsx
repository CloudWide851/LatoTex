import { Select } from "../../../components/ui/select";
import type { Dispatch, SetStateAction } from "react";
import type { AppSettings } from "../../../shared/types/app";

type TranslationFn = (key: any) => string;

export function CloseBehaviorCard(props: {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  t: TranslationFn;
}) {
  const { settings, setSettings, t } = props;
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-800">
        {t("settings.closeBehaviorTitle")}
      </h3>
      <div className="grid max-w-xs gap-2">
        <Select
          value={settings.uiPrefs?.closeBehavior ?? "ask"}
          onChange={(event) =>
            setSettings((prev) =>
              prev
                  ? {
                      ...prev,
                      uiPrefs: {
                        ...(prev.uiPrefs ?? {}),
                        closeBehavior: event.target.value as "ask" | "tray" | "exit",
                        closeBehaviorRemember: false,
                      },
                    }
                : prev,
            )
          }
        >
          <option value="ask">{t("settings.closeBehavior.ask")}</option>
          <option value="tray">{t("settings.closeBehavior.tray")}</option>
          <option value="exit">{t("settings.closeBehavior.exit")}</option>
        </Select>
        <p className="text-xs text-slate-500">{t("settings.closeBehaviorHint")}</p>
      </div>
    </div>
  );
}
