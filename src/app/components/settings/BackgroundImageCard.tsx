import type { Dispatch, SetStateAction } from "react";
import { useMemo } from "react";
import { Button } from "../../../components/ui/button";
import { pickBackgroundImage, removeBackgroundImage } from "../../../shared/api/desktop";
import { useBackgroundImageObjectUrl } from "../../hooks/useBackgroundImageObjectUrl";
import type { AppSettings } from "../../../shared/types/app";

type TranslationFn = (key: any) => string;

function normalizeBackgroundPaths(settings: AppSettings): string[] {
  const fromList = (settings.uiPrefs?.backgroundImagePaths ?? [])
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0);
  const legacy = String(settings.uiPrefs?.backgroundImagePath ?? "").trim();
  if (legacy && !fromList.includes(legacy)) {
    fromList.unshift(legacy);
  }
  return Array.from(new Set(fromList));
}

function clampBlur(value: number): number {
  if (!Number.isFinite(value)) {
    return 18;
  }
  return Math.max(4, Math.min(32, Math.round(value)));
}

function BackgroundThumb(props: {
  path: string;
  active: boolean;
  onSelect: (path: string) => void;
  onDelete: (path: string) => void;
  t: TranslationFn;
}) {
  const { path, active, onSelect, onDelete, t } = props;
  const previewUrl = useBackgroundImageObjectUrl(path);
  return (
    <button
      type="button"
      className={`group relative flex h-24 w-36 shrink-0 items-center justify-center overflow-hidden rounded-md border transition ${
        active
          ? "border-primary-500 ring-2 ring-primary-200"
          : "border-slate-300 hover:border-primary-300"
      }`}
      onClick={() => onSelect(path)}
      onContextMenu={(event) => {
        event.preventDefault();
        onDelete(path);
      }}
      title={active ? t("settings.backgroundCurrent") : path}
      aria-label={active ? t("settings.backgroundCurrent") : path}
    >
      {previewUrl ? (
        <img
          src={previewUrl}
          alt={t("settings.backgroundPreviewAlt")}
          className="h-full w-full bg-slate-100 object-contain"
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-slate-100 text-xs text-slate-500">
          {t("common.loading")}
        </div>
      )}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-slate-900/55 px-1 py-0.5 text-[10px] text-white opacity-0 transition group-hover:opacity-100">
        {t("settings.backgroundDelete")}
      </span>
    </button>
  );
}

export function BackgroundImageCard(props: {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  t: TranslationFn;
}) {
  const { settings, setSettings, t } = props;
  const paths = useMemo(() => normalizeBackgroundPaths(settings), [settings]);
  const activePath = String(settings.uiPrefs?.backgroundImagePath ?? "").trim() || paths[0] || "";
  const currentBlur = clampBlur(Number(settings.uiPrefs?.backgroundBlurPx ?? 18));

  const setBackgroundState = (updater: (prev: AppSettings) => AppSettings) => {
    setSettings((prev) => (prev ? updater(prev) : prev));
  };

  const handleUpload = async () => {
    try {
      const picked = await pickBackgroundImage();
      if (!picked?.path) {
        return;
      }
      const path = String(picked.path).trim();
      if (!path) {
        return;
      }
      setBackgroundState((prev) => {
        const existing = normalizeBackgroundPaths(prev);
        const nextPaths = existing.includes(path) ? existing : [...existing, path];
        return {
          ...prev,
          uiPrefs: {
            ...(prev.uiPrefs ?? {}),
            backgroundImagePaths: nextPaths,
            backgroundImagePath: path,
          },
        };
      });
    } catch {
      // ignore picker cancel/failure
    }
  };

  const handleDelete = (path: string) => {
    void (async () => {
      await removeBackgroundImage(path).catch(() => undefined);
      setBackgroundState((prev) => {
        const existing = normalizeBackgroundPaths(prev);
        const nextPaths = existing.filter((item) => item !== path);
        const current = String(prev.uiPrefs?.backgroundImagePath ?? "").trim();
        const nextCurrent = current === path ? (nextPaths[0] ?? "") : current;
        return {
          ...prev,
          uiPrefs: {
            ...(prev.uiPrefs ?? {}),
            backgroundImagePaths: nextPaths,
            backgroundImagePath: nextCurrent,
          },
        };
      });
    })();
  };

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-800">{t("settings.backgroundTitle")}</h3>
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void handleUpload()}>
            {t("settings.backgroundUpload")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setBackgroundState((prev) => ({
                ...prev,
                uiPrefs: {
                  ...(prev.uiPrefs ?? {}),
                  backgroundImagePath: "",
                },
              }))
            }
          >
            {t("settings.backgroundClear")}
          </Button>
        </div>

        <div className="grid gap-2">
          <label className="text-xs font-medium text-slate-600">{t("settings.backgroundBlurTitle")}</label>
          <input
            type="range"
            min={4}
            max={32}
            step={1}
            value={currentBlur}
            onChange={(event) => {
              const value = clampBlur(Number(event.target.value));
              setBackgroundState((prev) => ({
                ...prev,
                uiPrefs: {
                  ...(prev.uiPrefs ?? {}),
                  backgroundBlurPx: value,
                },
              }));
            }}
          />
          <p className="text-xs text-slate-500">{t("settings.backgroundBlurHint").replace("{value}", String(currentBlur))}</p>
        </div>

        {paths.length > 0 ? (
          <div className="grid gap-2">
            <p className="text-xs text-slate-500">{t("settings.backgroundGalleryHint")}</p>
            <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
              {paths.map((path) => (
                <BackgroundThumb
                  key={path}
                  path={path}
                  active={path === activePath}
                  onSelect={(nextPath) =>
                    setBackgroundState((prev) => ({
                      ...prev,
                      uiPrefs: {
                        ...(prev.uiPrefs ?? {}),
                        backgroundImagePath: nextPath,
                      },
                    }))
                  }
                  onDelete={handleDelete}
                  t={t}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-slate-300 p-3 text-xs text-slate-500">
            {t("settings.backgroundEmpty")}
          </div>
        )}
      </div>
    </div>
  );
}
