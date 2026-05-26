import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState, type Dispatch, type SetStateAction } from "react";
import { getPluginCatalog } from "../../../shared/api/plugins";
import type { AppSettings } from "../../../shared/types/app";
import type { PluginCatalogSource } from "../../../shared/plugins/pluginTypes";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { cn } from "../../../lib/utils";

type TranslationFn = (key: any) => string;

function normalizeSources(sources: PluginCatalogSource[]): PluginCatalogSource[] {
  return sources
    .map((source, index) => ({
      id: String(source.id || `catalog-${index + 1}`).trim(),
      name: String(source.name || source.id || `Catalog ${index + 1}`).trim(),
      url: String(source.url ?? "").trim(),
      enabled: source.enabled ?? true,
    }))
    .filter((source) => source.id.length > 0 || source.name.length > 0 || source.url.length > 0);
}

function createSource(existing: PluginCatalogSource[]): PluginCatalogSource {
  const ids = new Set(existing.map((item) => item.id));
  let index = existing.length + 1;
  let id = `catalog-${index}`;
  while (ids.has(id)) {
    index += 1;
    id = `catalog-${index}`;
  }
  return { id, name: `Catalog ${index}`, url: "", enabled: true };
}

export function PluginSourcesSettingsSection(props: {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  t: TranslationFn;
}) {
  const { settings, setSettings, t } = props;
  const sources = normalizeSources(settings.uiPrefs?.pluginCatalogSources ?? []);
  const [testing, setTesting] = useState<string | null>(null);
  const [resultById, setResultById] = useState<Record<string, { ok: boolean; message: string }>>({});

  const updateSources = (nextSources: PluginCatalogSource[]) => {
    setSettings((prev) => {
      const base = prev ?? settings;
      return {
        ...base,
        uiPrefs: {
          ...(base.uiPrefs ?? {}),
          pluginCatalogSources: normalizeSources(nextSources),
        },
      };
    });
  };
  const updateSource = (index: number, patch: Partial<PluginCatalogSource>) => {
    updateSources(sources.map((source, itemIndex) => (itemIndex === index ? { ...source, ...patch } : source)));
  };
  const testSource = async (source: PluginCatalogSource) => {
    const id = source.id.trim();
    setTesting(id);
    try {
      const result = await getPluginCatalog([{ ...source, enabled: true }]);
      setResultById((prev) => ({
        ...prev,
        [id]: {
          ok: result.warnings.length === 0,
          message: t("settings.pluginSourcesTestResult").replace("{count}", String(result.items.length)),
        },
      }));
    } catch (error) {
      setResultById((prev) => ({ ...prev, [id]: { ok: false, message: String(error) } }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="grid gap-3">
      <p className="text-xs text-slate-500">{t("settings.pluginSourcesHint")}</p>
      <div className="flex justify-end">
        <Button size="sm" variant="secondary" onClick={() => updateSources([...sources, createSource(sources)])}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t("settings.pluginSourcesAdd")}
        </Button>
      </div>
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        {t("settings.pluginSourcesBuiltin")}
      </div>
      {sources.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-500">
          {t("settings.pluginSourcesEmpty")}
        </div>
      ) : sources.map((source, index) => {
        const result = resultById[source.id];
        return (
          <section key={`${source.id}-${index}`} className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={source.enabled ?? true}
                  onChange={(event) => updateSource(index, { enabled: event.target.checked })}
                />
                {source.name || source.id}
              </label>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={testing === source.id || !source.url.trim()} onClick={() => void testSource(source)}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  {testing === source.id ? t("common.loading") : t("settings.pluginSourcesTest")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => updateSources(sources.filter((_, itemIndex) => itemIndex !== index))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-[minmax(120px,0.6fr)_minmax(140px,0.8fr)_minmax(220px,1.6fr)]">
              <Input value={source.id} onChange={(event) => updateSource(index, { id: event.target.value })} placeholder={t("settings.pluginSourcesId")} className="h-8 text-xs" />
              <Input value={source.name} onChange={(event) => updateSource(index, { name: event.target.value })} placeholder={t("settings.pluginSourcesName")} className="h-8 text-xs" />
              <Input value={source.url} onChange={(event) => updateSource(index, { url: event.target.value })} placeholder={t("settings.pluginSourcesUrl")} className="h-8 text-xs" />
            </div>
            {result ? (
              <div className={cn(
                "rounded border px-2 py-1.5 text-[11px]",
                result.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700",
              )}>
                {result.message}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
