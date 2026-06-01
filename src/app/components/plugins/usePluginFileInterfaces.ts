import { useEffect, useMemo, useState } from "react";
import { listInstalledPlugins } from "../../../shared/api/plugins";
import {
  enabledPluginManifests,
  type PluginFileInterfaceResolution,
  resolvePluginFileInterface,
} from "../../../shared/plugins/pluginFileInterfaces";
import type { InstalledPlugin, PluginManifest } from "../../../shared/plugins/pluginTypes";

const PLUGINS_CHANGED_EVENT = "latotex.plugins.changed";

export function notifyPluginsChanged() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(PLUGINS_CHANGED_EVENT));
}

export function usePluginFileManifests(active: boolean): PluginManifest[] {
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);

  useEffect(() => {
    if (!active) {
      setInstalled([]);
      return;
    }
    let cancelled = false;
    const reload = () => {
      void listInstalledPlugins()
        .then((plugins) => {
          if (!cancelled) {
            setInstalled(plugins);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setInstalled([]);
          }
        });
    };
    reload();
    window.addEventListener(PLUGINS_CHANGED_EVENT, reload);
    return () => {
      cancelled = true;
      window.removeEventListener(PLUGINS_CHANGED_EVENT, reload);
    };
  }, [active]);

  return useMemo(() => enabledPluginManifests(installed), [installed]);
}

export function usePluginFileInterface(
  path: string | null | undefined,
  manifests: PluginManifest[],
): PluginFileInterfaceResolution {
  return useMemo(() => resolvePluginFileInterface(path, manifests), [manifests, path]);
}
