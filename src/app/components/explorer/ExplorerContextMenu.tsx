import { createPortal } from "react-dom";
import type { FsAction } from "../../../shared/types/app";
import type { ExplorerMenuTarget } from "./treeUtils";

type TranslationFn = (key: any) => string;

type ExplorerContextMenuProps = {
  menu: ExplorerMenuTarget | null;
  mode: "workspace" | "library";
  allowRescan?: boolean;
  onClose: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRename: (path: string) => void;
  onTransfer: (action: "copy" | "move", path: string) => void;
  onDelete: (path: string) => Promise<boolean | void> | void;
  onRescan?: () => void;
  onImportPdf?: () => void;
  onImportLink?: () => void;
  onRevealInSystem?: (path?: string) => Promise<void> | void;
  onOpenTerminal?: (path?: string) => Promise<void> | void;
  t: TranslationFn;
};

export function ExplorerContextMenu(props: ExplorerContextMenuProps) {
  const {
    menu,
    mode,
    allowRescan,
    onClose,
    onNewFile,
    onNewFolder,
    onRename,
    onTransfer,
    onDelete,
    onRescan,
    onImportPdf,
    onImportLink,
    onRevealInSystem,
    onOpenTerminal,
    t,
  } = props;

  if (!menu) {
    return null;
  }

  const items: Array<{ key: string; onClick: () => Promise<boolean | void> | void }> = [];
  if (mode === "library" && menu.kind === "blank") {
    items.push(
      { key: "library.action.importPdf", onClick: () => onImportPdf?.() },
      { key: "library.action.importLink", onClick: () => onImportLink?.() },
      { key: "explorer.action.newFolder", onClick: onNewFolder },
    );
    if (allowRescan && onRescan) {
      items.push({ key: "explorer.action.rescan", onClick: onRescan });
    }
  } else if (menu.kind === "blank") {
    items.push(
      { key: "explorer.action.newFile", onClick: onNewFile },
      { key: "explorer.action.newFolder", onClick: onNewFolder },
      { key: "explorer.action.revealInSystem", onClick: () => onRevealInSystem?.("") },
      { key: "explorer.action.openTerminal", onClick: () => onOpenTerminal?.("") },
    );
    if (allowRescan && onRescan) {
      items.push({ key: "explorer.action.rescan", onClick: onRescan });
    }
  } else if (menu.kind === "directory") {
    if (mode === "workspace") {
      items.push({ key: "explorer.action.newFile", onClick: onNewFile });
    }
    items.push(
      { key: "explorer.action.newFolder", onClick: onNewFolder },
      { key: "explorer.action.rename", onClick: () => onRename(menu.path) },
      { key: "explorer.action.copy", onClick: () => onTransfer("copy", menu.path) },
      { key: "explorer.action.delete", onClick: () => onDelete(menu.path) },
    );
    if (mode === "workspace") {
      items.push(
        { key: "explorer.action.move", onClick: () => onTransfer("move", menu.path) },
        { key: "explorer.action.revealInSystem", onClick: () => onRevealInSystem?.(menu.path) },
        { key: "explorer.action.openTerminal", onClick: () => onOpenTerminal?.(menu.path) },
      );
    }
  } else {
    items.push(
      { key: "explorer.action.rename", onClick: () => onRename(menu.path) },
      { key: "explorer.action.copy", onClick: () => onTransfer("copy", menu.path) },
      { key: "explorer.action.delete", onClick: () => onDelete(menu.path) },
    );
    if (mode === "workspace") {
      items.push(
        { key: "explorer.action.move", onClick: () => onTransfer("move", menu.path) },
        { key: "explorer.action.revealInSystem", onClick: () => onRevealInSystem?.(menu.path) },
        { key: "explorer.action.openTerminal", onClick: () => onOpenTerminal?.(menu.path) },
      );
    }
  }

  const content = (
    <div
      data-explorer-context-menu="true"
      className="fixed z-[260] min-w-40 overflow-hidden rounded-md border border-slate-300 bg-white py-1 shadow-lg"
      style={{
        left: Math.max(8, Math.min(menu.x, (typeof window !== "undefined" ? window.innerWidth : menu.x) - 180)),
        top: Math.max(8, Math.min(menu.y, (typeof window !== "undefined" ? window.innerHeight : menu.y) - 220)),
      }}
    >
      {items.map((item) => (
        <button
          key={item.key}
          className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
          onClick={async (event) => {
            event.stopPropagation();
            onClose();
            await item.onClick();
          }}
        >
          {t(item.key)}
        </button>
      ))}
    </div>
  );

  if (typeof document === "undefined") {
    return content;
  }
  return createPortal(content, document.body);
}
