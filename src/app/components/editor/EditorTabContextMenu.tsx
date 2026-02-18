import type { CloseTabsAction } from "../../../shared/types/app";

type TranslationFn = (key: any) => string;

export function EditorTabContextMenu(props: {
  x: number;
  y: number;
  tabId: string;
  onAction: (action: CloseTabsAction, tabId: string) => void;
  onClose: () => void;
  t: TranslationFn;
}) {
  const { x, y, tabId, onAction, onClose, t } = props;

  const items: Array<{ key: string; action: CloseTabsAction }> = [
    { key: "editor.tab.close", action: "close" },
    { key: "editor.tab.closeLeft", action: "closeLeft" },
    { key: "editor.tab.closeRight", action: "closeRight" },
    { key: "editor.tab.closeOthers", action: "closeOthers" },
    { key: "editor.tab.closeSaved", action: "closeSaved" },
    { key: "editor.tab.closeAll", action: "closeAll" },
  ];

  return (
    <div
      className="fixed z-[70] min-w-44 overflow-hidden rounded-md border border-slate-300 bg-white py-1 shadow-lg"
      style={{ left: x, top: y }}
    >
      {items.map((item) => (
        <button
          key={item.action}
          className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
          onClick={() => {
            onClose();
            onAction(item.action, tabId);
          }}
        >
          {t(item.key)}
        </button>
      ))}
    </div>
  );
}
