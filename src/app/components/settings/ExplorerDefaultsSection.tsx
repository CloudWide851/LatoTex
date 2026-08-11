import type { Dispatch, SetStateAction } from "react";
import type { AppSettings } from "../../../shared/types/app";
import { InfoHint } from "../../../components/ui/info-hint";
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
  const workspaceScrollbarVisible = settings.uiPrefs?.workspaceExplorerScrollbarVisible ?? true;
  const libraryScrollbarVisible = settings.uiPrefs?.libraryExplorerScrollbarVisible ?? true;
  const resizeRefreshDelayMs = Math.max(
    500,
    Math.min(5000, Number(settings.uiPrefs?.editorResizeRefreshDelayMs ?? 2000)),
  );

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
      <div className="flex items-center gap-1">
        <h3 className="text-sm font-semibold text-slate-800">
          {t("settings.explorerDefaultsTitle")}
        </h3>
        <InfoHint content={t("settings.explorerDefaultsHint")} label={t("settings.explorerDefaultsTitle")} />
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
      <SettingsBooleanRow
        label={t("settings.workspaceExplorerScrollbarVisible")}
        checked={workspaceScrollbarVisible}
        onCheckedChange={(nextValue) => update({ workspaceExplorerScrollbarVisible: nextValue })}
      />
      <SettingsBooleanRow
        label={t("settings.libraryExplorerScrollbarVisible")}
        checked={libraryScrollbarVisible}
        onCheckedChange={(nextValue) => update({ libraryExplorerScrollbarVisible: nextValue })}
      />
      <div className="app-material-inset grid gap-2 rounded-[18px] border p-4 text-xs text-slate-600">
        <div className="flex items-center gap-1 font-medium text-slate-700">
          <span>{t("settings.editorResizeRefreshDelay")}</span>
          <InfoHint content={t("settings.editorResizeRefreshDelayHint")} label={t("settings.editorResizeRefreshDelay")} />
        </div>
        <div className="flex items-center gap-3">
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t("settings.editorResizeRefreshDelay")}</span>
            <input
              className="w-full"
              type="range"
              min={500}
              max={5000}
              step={250}
              value={resizeRefreshDelayMs}
              onChange={(event) => update({ editorResizeRefreshDelayMs: Number(event.target.value) })}
            />
          </label>
          <span className="w-16 text-right font-mono text-[11px]">
            {Math.round(resizeRefreshDelayMs / 100) / 10}s
          </span>
        </div>
      </div>
    </div>
  );
}
