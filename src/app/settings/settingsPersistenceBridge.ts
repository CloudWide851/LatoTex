import type { AppSettings } from "../../shared/types/app";

export const SETTINGS_PERSISTENCE_UNAVAILABLE = "settings.persistence.unavailable";

type SettingsPersistenceHandler = (settings: AppSettings) => Promise<AppSettings>;

let activeHandler: SettingsPersistenceHandler | null = null;

export function registerSettingsPersistence(handler: SettingsPersistenceHandler): () => void {
  activeHandler = handler;
  return () => {
    if (activeHandler === handler) {
      activeHandler = null;
    }
  };
}

export function persistSettingsNow(settings: AppSettings): Promise<AppSettings> {
  if (!activeHandler) {
    return Promise.reject(SETTINGS_PERSISTENCE_UNAVAILABLE);
  }
  return activeHandler(settings);
}
