import { ArrowDown, ArrowUp, RotateCcw } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { PAGE_ITEMS } from "../../app-config";
import {
  DEFAULT_PAGE_ORDER,
  moveSidebarPageOrderItem,
  normalizeSidebarPageOrder,
} from "../../pageRailOrder";
import type { AppSettings, WorkspacePage } from "../../../shared/types/app";
import { InfoHint } from "../../../components/ui/info-hint";

type TranslationFn = (key: any) => string;

export function SidebarPageOrderSettingsSection(props: {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  t: TranslationFn;
}) {
  const { settings, setSettings, t } = props;
  const order = normalizeSidebarPageOrder(settings.uiPrefs?.sidebarPageOrder);
  const itemMap = new Map(PAGE_ITEMS.map((item) => [item.id, item]));

  const updateOrder = (nextOrder: WorkspacePage[]) => {
    setSettings((prev) => {
      const base = prev ?? settings;
      return {
        ...base,
        uiPrefs: {
          ...(base.uiPrefs ?? {}),
          sidebarPageOrder: normalizeSidebarPageOrder(nextOrder),
        },
      };
    });
  };

  return (
    <section className="grid gap-3 rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <h3 className="text-sm font-semibold text-slate-800">{t("settings.sidebarOrderTitle")}</h3>
          <InfoHint content={t("settings.sidebarOrderHint")} label={t("settings.sidebarOrderTitle")} />
        </div>
        <button
          type="button"
          className="panel-topbar-btn inline-flex h-8 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-medium"
          onClick={() => updateOrder(DEFAULT_PAGE_ORDER)}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t("settings.sidebarOrderReset")}
        </button>
      </div>
      <div className="grid gap-2">
        {order.map((page, index) => {
          const item = itemMap.get(page);
          if (!item) {
            return null;
          }
          const Icon = item.icon;
          const previous = index > 0 ? itemMap.get(order[index - 1]) : null;
          const next = index < order.length - 1 ? itemMap.get(order[index + 1]) : null;
          const startsGroup = index === 0 || previous?.group !== item.group;
          return (
            <div key={page} className="grid gap-1">
              {startsGroup ? (
                <p className="mt-1 text-xs font-medium text-slate-500">
                  {t(item.group === "research" ? "nav.group.research" : "nav.group.tools")}
                </p>
              ) : null}
              <div
                className="app-material-inset flex min-h-10 items-center gap-2 rounded-md border px-2 text-sm text-slate-700"
              >
                <Icon className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="min-w-0 flex-1 truncate">{t(item.key)}</span>
                <button
                  type="button"
                  className="panel-topbar-btn inline-flex h-7 w-7 items-center justify-center rounded border disabled:opacity-40"
                  disabled={index === 0 || previous?.group !== item.group}
                  onClick={() => updateOrder(moveSidebarPageOrderItem(order, page, -1))}
                  title={t("settings.sidebarOrderMoveUp")}
                  aria-label={t("settings.sidebarOrderMoveUp")}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="panel-topbar-btn inline-flex h-7 w-7 items-center justify-center rounded border disabled:opacity-40"
                  disabled={index === order.length - 1 || next?.group !== item.group}
                  onClick={() => updateOrder(moveSidebarPageOrderItem(order, page, 1))}
                  title={t("settings.sidebarOrderMoveDown")}
                  aria-label={t("settings.sidebarOrderMoveDown")}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
