import { ArrowDown, ArrowUp, RotateCcw } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { PAGE_ITEMS } from "../../app-config";
import {
  DEFAULT_PAGE_ORDER,
  moveSidebarPageOrderItem,
  normalizeSidebarPageOrder,
} from "../../pageRailOrder";
import type { AppSettings, WorkspacePage } from "../../../shared/types/app";

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
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-800">{t("settings.sidebarOrderTitle")}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">{t("settings.sidebarOrderHint")}</p>
        </div>
        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
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
          return (
            <div
              key={page}
              className="flex min-h-10 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 text-sm text-slate-700"
            >
              <Icon className="h-4 w-4 shrink-0 text-slate-500" />
              <span className="min-w-0 flex-1 truncate">{t(item.key)}</span>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                disabled={index === 0}
                onClick={() => updateOrder(moveSidebarPageOrderItem(order, page, -1))}
                title={t("settings.sidebarOrderMoveUp")}
                aria-label={t("settings.sidebarOrderMoveUp")}
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                disabled={index === order.length - 1}
                onClick={() => updateOrder(moveSidebarPageOrderItem(order, page, 1))}
                title={t("settings.sidebarOrderMoveDown")}
                aria-label={t("settings.sidebarOrderMoveDown")}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
