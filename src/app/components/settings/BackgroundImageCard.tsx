import type { Dispatch, SetStateAction } from "react";
import { useMemo } from "react";
import { ImageOff, Plus, Trash2 } from "lucide-react";
import { removeBackgroundImage, pickBackgroundImage } from "../../../shared/api/settings";
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
          ? "border-[var(--app-accent)] ring-2 ring-[var(--control-primary-ring)]"
          : "border-slate-300 hover:border-[var(--app-accent)]"
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
        {t("settings.backgroundRightClickDelete")}
      </span>
    </button>
  );
}

function DefaultBackgroundCard(props: {
  active: boolean;
  onSelect: () => void;
  t: TranslationFn;
}) {
  const { active, onSelect, t } = props;
  return (
    <button
      type="button"
      className={`relative flex h-24 w-36 shrink-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-md border bg-white text-xs transition ${
        active
          ? "border-[var(--app-accent)] ring-2 ring-[var(--control-primary-ring)]"
          : "border-slate-300 hover:border-[var(--app-accent)]"
      }`}
      onClick={onSelect}
      title={active ? t("settings.backgroundCurrent") : t("settings.backgroundDefault")}
      aria-label={active ? t("settings.backgroundCurrent") : t("settings.backgroundDefault")}
    >
      <ImageOff className="h-5 w-5 text-slate-500" />
      <span className="font-medium text-slate-700">{t("settings.backgroundDefault")}</span>
      <span className="text-[10px] text-slate-500">{t("settings.backgroundDefaultHint")}</span>
    </button>
  );
}

function AddBackgroundCard(props: { onUpload: () => void; t: TranslationFn }) {
  const { onUpload, t } = props;
  return (
    <button
      type="button"
      className="settings-background-upload-card flex h-24 w-36 shrink-0 flex-col items-center justify-center rounded-md border border-dashed text-slate-600 transition"
      onClick={onUpload}
      title={t("settings.backgroundUpload")}
      aria-label={t("settings.backgroundUpload")}
    >
      <Plus className="h-5 w-5" />
      <span className="mt-1 text-[11px]">{t("settings.backgroundUpload")}</span>
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
  const activePath = String(settings.uiPrefs?.backgroundImagePath ?? "").trim();
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
    const normalizedPath = String(path ?? "").trim();
    if (!normalizedPath) {
      return;
    }
    void (async () => {
      await removeBackgroundImage(normalizedPath).catch(() => undefined);
      setBackgroundState((prev) => {
        const existing = normalizeBackgroundPaths(prev);
        const nextPaths = existing.filter((item) => item !== normalizedPath);
        const current = String(prev.uiPrefs?.backgroundImagePath ?? "").trim();
        const nextCurrent = current === normalizedPath ? "" : current;
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

  const selectDefaultBackground = () => {
    setBackgroundState((prev) => ({
      ...prev,
      uiPrefs: {
        ...(prev.uiPrefs ?? {}),
        backgroundImagePath: "",
      },
    }));
  };

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">{t("settings.backgroundTitle")}</h3>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-rose-300 bg-rose-50 text-rose-700 transition hover:bg-rose-100 disabled:opacity-40"
          onClick={selectDefaultBackground}
          disabled={!activePath}
          title={t("settings.backgroundClear")}
          aria-label={t("settings.backgroundClear")}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-3">
        <div className="grid gap-2">
          <label className="text-xs font-medium text-slate-600">{t("settings.backgroundBlurTitle")}</label>
          <input
            type="range"
            min={4}
            max={32}
            step={1}
            value={currentBlur}
            onInput={(event) => {
              const value = clampBlur(Number((event.target as HTMLInputElement).value));
              setBackgroundState((prev) => ({
                ...prev,
                uiPrefs: {
                  ...(prev.uiPrefs ?? {}),
                  backgroundBlurPx: value,
                },
              }));
            }}
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

        <div className="grid gap-2">
          <p className="text-xs text-slate-500">{t("settings.backgroundGalleryHint")}</p>
          <div className="settings-scrollbar-hidden flex max-w-full gap-2 overflow-x-auto pb-1">
            <DefaultBackgroundCard
              active={!activePath}
              onSelect={selectDefaultBackground}
              t={t}
            />
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
            <AddBackgroundCard onUpload={() => void handleUpload()} t={t} />
          </div>
          {paths.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 p-3 text-xs text-slate-500">
              {t("settings.backgroundEmpty")}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

