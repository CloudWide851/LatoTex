import { MoonStar, Sun, SunMoon } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { Select } from "../../../components/ui/select";
import { cn } from "../../../lib/utils";
import type { AppSettings } from "../../../shared/types/app";
import type { ThemeMode } from "../../app-config";
import { BackgroundImageCard } from "./BackgroundImageCard";
import { SettingsSelectRow } from "./SettingsSelectRow";

type TranslationFn = (key: any) => string;

const PREVIEW_ZOOM_OPTIONS = [0.75, 1, 1.25, 1.5, 2];
const DENSITY_OPTIONS = ["compact", "comfortable", "spacious"] as const;
const ACCENT_OPTIONS = ["emerald", "blue", "violet", "rose", "amber", "custom"] as const;
const MOTION_OPTIONS = ["full", "reduced", "none"] as const;
const CONTRAST_OPTIONS = ["soft", "normal", "strong"] as const;

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
}

export function AppearanceSettingsSection(props: {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  onThemeModeChange: (theme: ThemeMode, event?: { clientX: number; clientY: number }) => void;
  t: TranslationFn;
}) {
  const { settings, setSettings, onThemeModeChange, t } = props;
  const prefs = settings.uiPrefs ?? {};

  const updateUiPrefs = (patch: Partial<NonNullable<AppSettings["uiPrefs"]>>) => {
    setSettings((prev) => {
      const base = prev ?? settings;
      return { ...base, uiPrefs: { ...(base.uiPrefs ?? {}), ...patch } };
    });
  };

  return (
    <div className="grid gap-3">
      <div className="rounded-lg border border-slate-200 p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">
          {t("settings.themeTitle")}
        </h3>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            { id: "light" as const, key: "settings.theme.light" as const, icon: Sun },
            { id: "dark" as const, key: "settings.theme.dark" as const, icon: MoonStar },
            { id: "system" as const, key: "settings.theme.system" as const, icon: SunMoon },
          ].map((item) => {
            const Icon = item.icon;
            const selected = (prefs.theme ?? "system") === item.id;
            return (
              <button
                key={item.id}
                className={cn(
                  "flex h-11 items-center justify-center gap-2 rounded-md border text-sm transition",
                  selected
                    ? "border-primary-600 bg-primary-600 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
                )}
                onClick={(event) =>
                  onThemeModeChange(item.id, {
                    clientX: event.clientX,
                    clientY: event.clientY,
                  })
                }
              >
                <Icon className="h-4 w-4" />
                <span>{t(item.key)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <SettingsSelectRow
        title={t("settings.interfaceDensityTitle")}
        value={prefs.interfaceDensity ?? "comfortable"}
        description={t("settings.interfaceDensityHint")}
        options={DENSITY_OPTIONS.map((value) => ({
          value,
          label: t(`settings.interfaceDensity.${value}`),
        }))}
        onChange={(value) => updateUiPrefs({ interfaceDensity: value as typeof DENSITY_OPTIONS[number] })}
      />

      <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-800">
          {t("settings.colorStyleTitle")}
        </h3>
        <SettingsSelectRow
          title={t("settings.accentColorTitle")}
          value={prefs.accentColor ?? "emerald"}
          description={t("settings.accentColorHint")}
          options={ACCENT_OPTIONS.map((value) => ({
            value,
            label: t(`settings.accentColor.${value}`),
          }))}
          onChange={(value) => updateUiPrefs({ accentColor: value as typeof ACCENT_OPTIONS[number] })}
        />
        <label className="grid gap-1 text-xs text-slate-600">
          <span>{t("settings.customAccentColor")}</span>
          <input
            type="color"
            value={prefs.accentCustomColor || "#22c55e"}
            className="h-9 w-20 rounded border border-slate-300 bg-white p-1"
            onChange={(event) => updateUiPrefs({ accentColor: "custom", accentCustomColor: event.target.value })}
          />
        </label>
      </div>

      <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-800">
          {t("settings.scrollbarStyleTitle")}
        </h3>
        <label className="grid gap-1 text-xs text-slate-600">
          <span>{t("settings.scrollbarWidth")}</span>
          <input
            type="range"
            min={8}
            max={18}
            value={clampNumber(prefs.scrollbarWidthPx, 8, 18, 14)}
            onChange={(event) => updateUiPrefs({ scrollbarWidthPx: Number(event.target.value) })}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="grid gap-1 text-xs text-slate-600">
            <span>{t("settings.scrollbarThumbColor")}</span>
            <input
              type="color"
              value={prefs.scrollbarThumbColor || "#22c55e"}
              className="h-9 w-20 rounded border border-slate-300 bg-white p-1"
              onChange={(event) => updateUiPrefs({ scrollbarThumbColor: event.target.value })}
            />
          </label>
          <label className="grid gap-1 text-xs text-slate-600">
            <span>{t("settings.scrollbarTrackColor")}</span>
            <input
              type="color"
              value={prefs.scrollbarTrackColor || "#cbd5e1"}
              className="h-9 w-20 rounded border border-slate-300 bg-white p-1"
              onChange={(event) => updateUiPrefs({ scrollbarTrackColor: event.target.value })}
            />
          </label>
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-800">
          {t("settings.surfaceStyleTitle")}
        </h3>
        <label className="grid gap-1 text-xs text-slate-600">
          <span>{t("settings.glassOpacity")}</span>
          <input
            type="range"
            min={0.55}
            max={1}
            step={0.01}
            value={clampNumber(prefs.glassOpacity, 0.55, 1, 0.78)}
            onChange={(event) => updateUiPrefs({ glassOpacity: Number(event.target.value) })}
          />
        </label>
        <label className="grid gap-1 text-xs text-slate-600">
          <span>{t("settings.glassBlur")}</span>
          <input
            type="range"
            min={0}
            max={32}
            value={clampNumber(prefs.glassBlurPx, 0, 32, 18)}
            onChange={(event) => updateUiPrefs({ glassBlurPx: Number(event.target.value) })}
          />
        </label>
        <label className="grid gap-1 text-xs text-slate-600">
          <span>{t("settings.panelRadius")}</span>
          <input
            type="range"
            min={4}
            max={14}
            value={clampNumber(prefs.panelRadiusPx, 4, 14, 8)}
            onChange={(event) => updateUiPrefs({ panelRadiusPx: Number(event.target.value) })}
          />
        </label>
        <SettingsSelectRow
          title={t("settings.panelBorderContrast")}
          value={prefs.panelBorderContrast ?? "normal"}
          description={t("settings.panelBorderContrastHint")}
          options={CONTRAST_OPTIONS.map((value) => ({
            value,
            label: t(`settings.panelBorderContrast.${value}`),
          }))}
          onChange={(value) => updateUiPrefs({ panelBorderContrast: value as typeof CONTRAST_OPTIONS[number] })}
        />
      </div>

      <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-800">
          {t("settings.contentStyleTitle")}
        </h3>
        <div className="grid max-w-xs gap-2">
          <Select
            value={String(prefs.previewDefaultZoom ?? 1)}
            onChange={(event) => updateUiPrefs({ previewDefaultZoom: Number(event.target.value) })}
          >
            {PREVIEW_ZOOM_OPTIONS.map((value) => (
              <option key={value} value={String(value)}>
                {`${Math.round(value * 100)}%`}
              </option>
            ))}
          </Select>
          <p className="text-xs text-slate-500">{t("settings.previewZoomHint")}</p>
        </div>
        <label className="grid gap-1 text-xs text-slate-600">
          <span>{t("settings.pdfPageGap")}</span>
          <input
            type="range"
            min={4}
            max={28}
            value={clampNumber(prefs.pdfPageGapPx, 4, 28, 12)}
            onChange={(event) => updateUiPrefs({ pdfPageGapPx: Number(event.target.value) })}
          />
        </label>
        <label className="grid gap-1 text-xs text-slate-600">
          <span>{t("settings.logFontSize")}</span>
          <input
            type="range"
            min={10}
            max={16}
            value={clampNumber(prefs.logFontSizePx, 10, 16, 12)}
            onChange={(event) => updateUiPrefs({ logFontSizePx: Number(event.target.value) })}
          />
        </label>
        <SettingsSelectRow
          title={t("settings.motionLevelTitle")}
          value={prefs.motionLevel ?? "full"}
          description={t("settings.motionLevelHint")}
          options={MOTION_OPTIONS.map((value) => ({
            value,
            label: t(`settings.motionLevel.${value}`),
          }))}
          onChange={(value) => updateUiPrefs({ motionLevel: value as typeof MOTION_OPTIONS[number] })}
        />
      </div>

      <BackgroundImageCard settings={settings} setSettings={setSettings} t={t} />
    </div>
  );
}
