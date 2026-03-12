import { convertFileSrc } from "@tauri-apps/api/core";
import type { Dispatch, SetStateAction } from "react";
import { Button } from "../../../components/ui/button";
import { pickBackgroundImage } from "../../../shared/api/desktop";
import type { AppSettings } from "../../../shared/types/app";

type TranslationFn = (key: any) => string;

function resolveBackgroundPreview(path: string): string {
  const raw = path.trim();
  if (!raw) {
    return "";
  }
  try {
    return convertFileSrc(raw);
  } catch {
    return raw;
  }
}

export function BackgroundImageCard(props: {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  t: TranslationFn;
}) {
  const { settings, setSettings, t } = props;
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-800">
        {t("settings.backgroundTitle")}
      </h3>
      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              void (async () => {
                try {
                  const picked = await pickBackgroundImage();
                  if (!picked?.path) {
                    return;
                  }
                  setSettings((prev) =>
                    prev
                      ? {
                          ...prev,
                          uiPrefs: {
                            ...(prev.uiPrefs ?? {}),
                            backgroundImagePath: picked.path,
                          },
                        }
                      : prev,
                  );
                } catch {
                  // Ignore picker cancel/failure in UI component.
                }
              })();
            }}
          >
            {t("settings.backgroundUpload")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setSettings((prev) =>
                prev
                  ? {
                      ...prev,
                      uiPrefs: {
                        ...(prev.uiPrefs ?? {}),
                        backgroundImagePath: "",
                      },
                    }
                  : prev,
              )
            }
          >
            {t("settings.backgroundClear")}
          </Button>
        </div>
        {settings.uiPrefs?.backgroundImagePath ? (
          <img
            src={resolveBackgroundPreview(settings.uiPrefs.backgroundImagePath)}
            alt={t("settings.backgroundPreviewAlt")}
            className="h-28 w-full rounded-md border border-slate-200 object-cover"
          />
        ) : null}
        <p className="text-xs text-slate-500">{t("settings.backgroundHint")}</p>
      </div>
    </div>
  );
}
