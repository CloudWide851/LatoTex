import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { getPluginCatalog, listInstalledPlugins } from "../../../shared/api/plugins";
import type { AppSettings } from "../../../shared/types/app";
import { SettingsBooleanRow } from "./SettingsBooleanRow";

type TranslationFn = (key: any) => string;

export function DocxSettingsSection(props: {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  t: TranslationFn;
}) {
  const { settings, setSettings, t } = props;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let disposed = false;
    Promise.all([listInstalledPlugins(), getPluginCatalog([])])
      .then(([plugins, catalog]) => {
        if (!disposed) {
          const installed = plugins.some((plugin) => plugin.enabled && plugin.manifest.id === "latotex.docx-workspace");
          const builtIn = catalog.items.some((entry) => entry.sourceId === "builtin" && entry.manifest.id === "latotex.docx-workspace");
          setVisible(installed || builtIn);
        }
      })
      .catch(() => {
        if (!disposed) {
          setVisible(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <SettingsBooleanRow
      label={t("settings.docxAutoSave")}
      checked={settings.uiPrefs?.docxAutoSaveEnabled ?? false}
      onCheckedChange={(nextValue) =>
        setSettings((prev) => {
          const base = prev ?? settings;
          return {
            ...base,
            uiPrefs: {
              ...(base.uiPrefs ?? {}),
              docxAutoSaveEnabled: nextValue,
            },
          };
        })
      }
    />
  );
}
