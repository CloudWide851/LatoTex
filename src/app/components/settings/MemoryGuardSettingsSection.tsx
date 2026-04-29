import type { Dispatch, SetStateAction } from "react";
import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/select";
import type { AppSettings, MemoryGuardPrefs } from "../../../shared/types/app";
import { SettingsBooleanRow } from "./SettingsBooleanRow";

type TranslationFn = (key: any) => string;

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

export function MemoryGuardSettingsSection(props: {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  onReleaseMemory?: () => void;
  t: TranslationFn;
}) {
  const { settings, setSettings, onReleaseMemory, t } = props;
  const prefs: MemoryGuardPrefs = {
    enabled: true,
    highWatermarkMb: 560,
    criticalWatermarkMb: 760,
    sampleIntervalSec: 25,
    criticalAction: "sleep",
    ...(settings.uiPrefs?.memoryGuardPrefs ?? {}),
  };

  const updatePrefs = (patch: Partial<MemoryGuardPrefs>) => {
    const nextPrefs = { ...prefs, ...patch };
    setSettings((prev) => {
      const base = prev ?? settings;
      return {
        ...base,
        uiPrefs: {
          ...(base.uiPrefs ?? {}),
          memoryGuardPrefs: nextPrefs,
        },
      };
    });
  };

  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">
            {t("settings.memoryGuardTitle")}
          </h3>
          <p className="mt-1 text-xs text-slate-500">{t("settings.memoryGuardHint")}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={onReleaseMemory}>
          {t("settings.memoryGuardReleaseNow")}
        </Button>
      </div>
      <SettingsBooleanRow
        label={t("settings.memoryGuardEnabled")}
        checked={Boolean(prefs.enabled)}
        onCheckedChange={(value) => updatePrefs({ enabled: value })}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-xs text-slate-600">
          <span>{t("settings.memoryGuardHigh")}</span>
          <input
            className="rounded border border-slate-300 px-2 py-1"
            type="number"
            min={256}
            max={4096}
            value={clampInt(prefs.highWatermarkMb, 256, 4096, 560)}
            onChange={(event) => updatePrefs({ highWatermarkMb: clampInt(event.target.value, 256, 4096, 560) })}
          />
        </label>
        <label className="grid gap-1 text-xs text-slate-600">
          <span>{t("settings.memoryGuardCritical")}</span>
          <input
            className="rounded border border-slate-300 px-2 py-1"
            type="number"
            min={384}
            max={6144}
            value={clampInt(prefs.criticalWatermarkMb, 384, 6144, 760)}
            onChange={(event) => updatePrefs({ criticalWatermarkMb: clampInt(event.target.value, 384, 6144, 760) })}
          />
        </label>
        <label className="grid gap-1 text-xs text-slate-600">
          <span>{t("settings.memoryGuardInterval")}</span>
          <input
            className="rounded border border-slate-300 px-2 py-1"
            type="number"
            min={10}
            max={180}
            value={clampInt(prefs.sampleIntervalSec, 10, 180, 25)}
            onChange={(event) => updatePrefs({ sampleIntervalSec: clampInt(event.target.value, 10, 180, 25) })}
          />
        </label>
      </div>
      <Select
        value={prefs.criticalAction ?? "sleep"}
        onChange={(event) => updatePrefs({ criticalAction: event.target.value as "release" | "sleep" })}
      >
        <option value="release">{t("settings.memoryGuardAction.release")}</option>
        <option value="sleep">{t("settings.memoryGuardAction.sleep")}</option>
      </Select>
    </div>
  );
}
