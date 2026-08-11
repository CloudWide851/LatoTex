import { ChevronDown, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Select } from "../../../components/ui/select";
import { cn } from "../../../lib/utils";
import { SETTINGS_SECTIONS, type SettingsSection } from "../../app-config";

type TranslationFn = (key: any) => string;

type SettingsNavigationGroup = {
  id: "workspace" | "intelligence" | "extensions" | "advanced";
  labelKey: string;
  sectionIds: SettingsSection[];
};

const SETTINGS_NAVIGATION_GROUPS: SettingsNavigationGroup[] = [
  {
    id: "workspace",
    labelKey: "settings.navigation.group.workspace",
    sectionIds: ["general", "appearance", "channels"],
  },
  {
    id: "intelligence",
    labelKey: "settings.navigation.group.intelligence",
    sectionIds: ["knowledge", "models", "agents", "agent-teams"],
  },
  {
    id: "extensions",
    labelKey: "settings.navigation.group.extensions",
    sectionIds: ["plugin-sources"],
  },
  {
    id: "advanced",
    labelKey: "settings.navigation.group.advanced",
    sectionIds: ["agent-tools", "agent-permissions", "mcp", "skills", "doctor", "diagnostics"],
  },
];

const ADVANCED_SECTION_IDS = new Set<SettingsSection>(
  SETTINGS_NAVIGATION_GROUPS.find((group) => group.id === "advanced")?.sectionIds ?? [],
);

export function isAdvancedSettingsSection(section: SettingsSection): boolean {
  return ADVANCED_SECTION_IDS.has(section);
}

export type SettingsNavigationProjection = Array<{
  id: SettingsNavigationGroup["id"];
  label: string;
  sections: typeof SETTINGS_SECTIONS;
}>;

export function buildSettingsNavigationProjection(
  query: string,
  t: TranslationFn,
): SettingsNavigationProjection {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return SETTINGS_NAVIGATION_GROUPS.map((group) => {
    const label = t(group.labelKey);
    const sections = SETTINGS_SECTIONS.filter((item) => group.sectionIds.includes(item.id)).filter((item) => {
      if (!normalizedQuery) {
        return true;
      }
      const haystack = [
        t(item.key),
        item.id,
        label,
        t(`settings.navigation.keywords.${item.id}`),
      ].join(" ").toLocaleLowerCase();
      return haystack.includes(normalizedQuery);
    });
    return { id: group.id, label, sections };
  }).filter((group) => group.sections.length > 0);
}

export function applyExternalSettingsSectionRequest(
  section: SettingsSection,
  clearQuery: () => void,
  onSectionChange: (section: SettingsSection) => void,
) {
  clearQuery();
  onSectionChange(section);
}

export function SettingsNavigation(props: {
  selectedSection: SettingsSection;
  query: string;
  onQueryChange: (query: string) => void;
  onSectionChange: (section: SettingsSection) => void;
  t: TranslationFn;
}) {
  const { selectedSection, query, onQueryChange, onSectionChange, t } = props;
  const groups = buildSettingsNavigationProjection(query, t);
  const [advancedExpanded, setAdvancedExpanded] = useState(() => isAdvancedSettingsSection(selectedSection));
  const advancedGroup = groups.find((group) => group.id === "advanced");
  const commonGroups = groups.filter((group) => group.id !== "advanced");
  const queryTargetsAdvanced = Boolean(query.trim() && advancedGroup);
  const showAdvancedSections = advancedExpanded || queryTargetsAdvanced;
  const visibleSections = groups.flatMap((group) => group.sections);
  const selectedItem = SETTINGS_SECTIONS.find((item) => item.id === selectedSection);
  const compactSections = selectedItem && !visibleSections.some((item) => item.id === selectedSection)
    ? [selectedItem, ...visibleSections]
    : visibleSections;

  useEffect(() => {
    if (isAdvancedSettingsSection(selectedSection) || queryTargetsAdvanced) {
      setAdvancedExpanded(true);
    }
  }, [queryTargetsAdvanced, selectedSection]);

  return (
    <aside className="app-material-inset grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2 border-r p-2 max-[980px]:grid-rows-[auto_auto] max-[980px]:border-b max-[980px]:border-r-0">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          type="search"
          value={query}
          aria-label={t("settings.navigation.search")}
          placeholder={t("settings.navigation.search")}
          className="app-material-content h-9 w-full rounded-md border py-1 pl-8 pr-2 text-xs text-slate-700 outline-none transition focus:border-[color:var(--app-accent)] focus:ring-2 focus:ring-[color:var(--control-ring)]"
          onChange={(event) => onQueryChange(event.currentTarget.value)}
        />
      </label>

      <div className="settings-scrollbar-hidden min-h-0 space-y-3 overflow-auto max-[980px]:hidden">
        {commonGroups.map((group) => (
          <section key={group.id} aria-labelledby={`settings-group-${group.id}`}>
            <h3 id={`settings-group-${group.id}`} className="mb-1 px-2 text-xs font-medium text-slate-500">
              {group.label}
            </h3>
            <div className="space-y-1">
              {group.sections.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={selectedSection === item.id ? "page" : undefined}
                    className={cn(
                      "settings-nav-item flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--control-ring)]",
                      selectedSection === item.id && "settings-nav-item--active",
                    )}
                    onClick={() => onSectionChange(item.id)}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{t(item.key)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        {advancedGroup ? (
          <section aria-labelledby="settings-group-advanced">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs font-medium text-slate-500 transition hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--control-ring)]"
              aria-expanded={showAdvancedSections}
              aria-controls="settings-advanced-sections"
              onClick={() => setAdvancedExpanded((current) => !current)}
              title={t(showAdvancedSections ? "settings.navigation.advancedHide" : "settings.navigation.advancedShow")}
            >
              <span id="settings-group-advanced">{advancedGroup.label}</span>
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", showAdvancedSections && "rotate-180")}
                aria-hidden="true"
              />
            </button>
            {showAdvancedSections ? (
              <div id="settings-advanced-sections" className="mt-1 space-y-1">
                {advancedGroup.sections.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={selectedSection === item.id ? "page" : undefined}
                      className={cn(
                        "settings-nav-item flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--control-ring)]",
                        selectedSection === item.id && "settings-nav-item--active",
                      )}
                      onClick={() => onSectionChange(item.id)}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{t(item.key)}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </section>
        ) : null}
        {groups.length === 0 ? (
          <p role="status" className="app-material-content rounded-md border px-3 py-4 text-xs leading-5 text-slate-500">
            {t("settings.navigation.noMatches")}
          </p>
        ) : null}
      </div>

      <div className="hidden max-[980px]:block">
        <Select
          value={selectedSection}
          aria-label={t("settings.navigation.compactLabel")}
          className="h-9 w-full"
          onChange={(event) => onSectionChange(event.currentTarget.value as SettingsSection)}
        >
          {compactSections.map((item) => (
            <option key={item.id} value={item.id}>{t(item.key)}</option>
          ))}
        </Select>
        {groups.length === 0 ? (
          <p role="status" className="mt-2 text-xs text-slate-500">{t("settings.navigation.noMatches")}</p>
        ) : null}
      </div>
    </aside>
  );
}
