import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2 } from "lucide-react";
import { removeBackgroundImage, pickBackgroundImage } from "../../../shared/api/settings";
import { useBackgroundImageObjectUrl } from "../../hooks/useBackgroundImageObjectUrl";
import type { AppSettings } from "../../../shared/types/app";

type TranslationFn = (key: any) => string;

type ThumbMenuState = {
  path: string;
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
} | null;

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

function clampMenuPosition(
  x: number,
  y: number,
  width = 180,
  height = 80,
): { x: number; y: number } {
  if (typeof window === "undefined") {
    return { x, y };
  }
  const padding = 8;
  const maxX = Math.max(padding, window.innerWidth - width - padding);
  const maxY = Math.max(padding, window.innerHeight - height - padding);
  return {
    x: Math.max(padding, Math.min(x, maxX)),
    y: Math.max(padding, Math.min(y, maxY)),
  };
}

function BackgroundThumb(props: {
  path: string;
  active: boolean;
  onSelect: (path: string) => void;
  onOpenMenu: (path: string, x: number, y: number) => void;
  t: TranslationFn;
}) {
  const { path, active, onSelect, onOpenMenu, t } = props;
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
        onOpenMenu(path, event.clientX, event.clientY);
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

function AddBackgroundCard(props: { onUpload: () => void; t: TranslationFn }) {
  const { onUpload, t } = props;
  return (
    <button
      type="button"
      className="flex h-24 w-36 shrink-0 flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-slate-600 transition hover:border-primary-400 hover:bg-primary-50"
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
  const activePath = String(settings.uiPrefs?.backgroundImagePath ?? "").trim() || paths[0] || "";
  const currentBlur = clampBlur(Number(settings.uiPrefs?.backgroundBlurPx ?? 18));
  const [menuState, setMenuState] = useState<ThumbMenuState>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const setBackgroundState = (updater: (prev: AppSettings) => AppSettings) => {
    setSettings((prev) => (prev ? updater(prev) : prev));
  };

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (!menuState) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-bg-thumb-menu='true']")) {
        return;
      }
      setMenuState(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuState(null);
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuState]);

  useEffect(() => {
    if (!menuState) {
      return;
    }
    const recalc = () => {
      setMenuState((prev) => {
        if (!prev) {
          return prev;
        }
        const rect = menuRef.current?.getBoundingClientRect();
        const point = clampMenuPosition(prev.anchorX, prev.anchorY, rect?.width ?? 180, rect?.height ?? 80);
        if (point.x === prev.x && point.y === prev.y) {
          return prev;
        }
        return {
          ...prev,
          x: point.x,
          y: point.y,
        };
      });
    };
    const raf = window.requestAnimationFrame(recalc);
    window.addEventListener("resize", recalc);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", recalc);
    };
  }, [menuState]);

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
      setMenuState(null);
    })();
  };

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">{t("settings.backgroundTitle")}</h3>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-rose-300 bg-rose-50 text-rose-700 transition hover:bg-rose-100 disabled:opacity-40"
          onClick={() => {
            if (activePath) {
              handleDelete(activePath);
            }
          }}
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
                onOpenMenu={(menuPath, x, y) => {
                  const point = clampMenuPosition(x, y);
                  setMenuState({
                    path: menuPath,
                    anchorX: x,
                    anchorY: y,
                    x: point.x,
                    y: point.y,
                  });
                }}
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

      {menuState
        ? (typeof document !== "undefined"
          ? createPortal(
            <div
              ref={menuRef}
              data-bg-thumb-menu="true"
              className="fixed z-[260] min-w-40 overflow-hidden rounded-md border border-slate-300 bg-white py-1 shadow-lg"
              style={{ left: menuState.x, top: menuState.y }}
            >
              <button
                className="block w-full px-3 py-1.5 text-left text-xs text-rose-700 hover:bg-rose-50"
                onClick={() => handleDelete(menuState.path)}
              >
                {t("settings.backgroundDelete")}
              </button>
            </div>,
            document.body,
          )
          : (
            <div
              ref={menuRef}
              data-bg-thumb-menu="true"
              className="fixed z-[260] min-w-40 overflow-hidden rounded-md border border-slate-300 bg-white py-1 shadow-lg"
              style={{ left: menuState.x, top: menuState.y }}
            >
              <button
                className="block w-full px-3 py-1.5 text-left text-xs text-rose-700 hover:bg-rose-50"
                onClick={() => handleDelete(menuState.path)}
              >
                {t("settings.backgroundDelete")}
              </button>
            </div>
          ))
        : null}
    </div>
  );
}

