import { createPortal } from "react-dom";
import type { KnowledgeItem } from "../../../shared/types/app";
import { cspStyle } from "../../../shared/ui/cspStyle";

type TranslationFn = (key: any) => string;

export type KnowledgeEntryMenuState = {
  x: number;
  y: number;
  item: KnowledgeItem;
} | null;

export function KnowledgeEntryMenu(props: {
  menu: KnowledgeEntryMenuState;
  busy: boolean;
  onClose: () => void;
  onOpenSource: (item: KnowledgeItem) => void;
  onReindex: (item: KnowledgeItem) => Promise<void>;
  onUnarchive: (item: KnowledgeItem) => Promise<void>;
  t: TranslationFn;
}) {
  if (!props.menu || typeof document === "undefined") {
    return null;
  }
  const { item, x, y } = props.menu;
  const actions = [
    { key: "knowledge.revealSource", run: () => props.onOpenSource(item) },
    { key: "knowledge.reindex", run: () => props.onReindex(item) },
    { key: "knowledge.unarchive", run: () => props.onUnarchive(item) },
  ];
  return createPortal(
    <div
      className="app-material-floating fixed z-[280] min-w-44 overflow-hidden rounded-md py-1"
      {...cspStyle({
        left: Math.max(8, Math.min(x, window.innerWidth - 190)),
        top: Math.max(8, Math.min(y, window.innerHeight - 132)),
      })}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
    >
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          role="menuitem"
          disabled={props.busy}
          className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-accent)] disabled:opacity-50"
          onClick={async () => {
            props.onClose();
            await action.run();
          }}
        >
          {props.t(action.key)}
        </button>
      ))}
    </div>,
    document.body,
  );
}
