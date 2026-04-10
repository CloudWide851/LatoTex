import type { Dispatch, SetStateAction } from "react";
import type { AppSettings } from "../../../shared/types/app";
import { SettingsSelectRow } from "./SettingsSelectRow";

type TranslationFn = (key: any) => string;

export function CloseBehaviorCard(props: {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  t: TranslationFn;
}) {
  const { settings, setSettings, t } = props;
  return (
    <SettingsSelectRow
      title={t("settings.closeBehaviorTitle")}
      value={settings.uiPrefs?.closeBehavior ?? "ask"}
      description={t("settings.closeBehaviorHint")}
      options={[
        { value: "ask", label: t("settings.closeBehavior.ask") },
        { value: "tray", label: t("settings.closeBehavior.tray") },
        { value: "exit", label: t("settings.closeBehavior.exit") },
      ]}
      onChange={(value) =>
        setSettings((prev) =>
          prev
            ? {
                ...prev,
                uiPrefs: {
                  ...(prev.uiPrefs ?? {}),
                  closeBehavior: value as "ask" | "tray" | "exit",
                  closeBehaviorRemember: false,
                },
              }
            : prev,
        )
      }
    />
  );
}
