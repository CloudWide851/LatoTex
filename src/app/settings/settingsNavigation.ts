import type { SettingsSection } from "../app-config";

type SettingsSectionListener = (section: SettingsSection) => void;

const listeners = new Set<SettingsSectionListener>();
let pendingSection: SettingsSection | null = null;

export function requestSettingsSection(section: SettingsSection): void {
  if (listeners.size === 0) {
    pendingSection = section;
    return;
  }
  pendingSection = null;
  listeners.forEach((listener) => listener(section));
}

export function subscribeSettingsSectionRequests(listener: SettingsSectionListener): () => void {
  listeners.add(listener);
  if (pendingSection) {
    const section = pendingSection;
    pendingSection = null;
    listener(section);
  }
  return () => {
    listeners.delete(listener);
  };
}
