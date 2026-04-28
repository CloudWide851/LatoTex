import type { Dispatch, SetStateAction } from "react";
import type { AppSettings } from "../../../shared/types/app";
import { SettingsBooleanRow } from "./SettingsBooleanRow";

type TranslationFn = (key: any) => string;

export function ExplorerDefaultsSection(props: {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  t: TranslationFn;
}) {
  const { settings, setSettings, t } = props;
  const workspaceExpanded = settings.uiPrefs?.workspaceExplorerDefaultExpanded ?? true;
  const libraryExpanded = settings.uiPrefs?.libraryExplorerDefaultExpanded ?? true;

  const update = (patch: Partial<NonNullable<AppSettings["uiPrefs"]>>) => {
    setSettings((prev) => {
      const base = prev ?? settings;
      return {
        ...base,
        uiPrefs: {
          ...(base.uiPrefs ?? {}),
          ...patch,
        },
      };
    });
  };

  return (
    <div className="grid gap-2 rounded-lg border border-slate-200 p-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">
          {t("settings.explorerDefaultsTitle")}
        </h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          {t("settings.explorerDefaultsHint")}
        </p>
      </div>
      <SettingsBooleanRow
        label={t("settings.workspaceExplorerDefaultExpanded")}
        checked={workspaceExpanded}
        onCheckedChange={(nextValue) => update({ workspaceExplorerDefaultExpanded: nextValue })}
      />
      <SettingsBooleanRow
        label={t("settings.libraryExplorerDefaultExpanded")}
        checked={libraryExpanded}
        onCheckedChange={(nextValue) => update({ libraryExplorerDefaultExpanded: nextValue })}
      />
    </div>
  );
}
