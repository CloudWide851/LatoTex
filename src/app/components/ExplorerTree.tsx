import { ChevronRight, FileCode2, Files, Folder, FolderOpen } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";
import type { FsAction } from "../../shared/types/app";
import { ExplorerLinkDraftPanel, ExplorerTransferPanel } from "./explorer/ExplorerInlinePanels";
import {
  collectVisibleFilePaths,
  resolveExplorerSelection,
  shouldAutoExpandNode,
} from "./explorer/explorerSelection";
import {
  dirnameOf,
  type EditingState,
  type ExplorerMenuTarget,
  joinPath,
  type MoveCopyPanel,
  resolveDecorationTone,
} from "./explorer/treeUtils";
import type { ResourceNode } from "../../shared/types/app";
type TranslationFn = (key: any) => string;
export function ExplorerTree(props: {
  mode?: "workspace" | "library";
  tree: ResourceNode[];
  selectedPath: string | null;
  dirtyByPath?: Record<string, boolean>;
  gitDecorations?: Record<
    string,
    { code: string; ignored: boolean; staged: boolean; unstaged: boolean; untracked: boolean }
  >;
  allowRescan?: boolean;
  busy?: boolean;
  onSelect: (path: string) => void;
  onAction?: (action: FsAction, path: string, targetPath?: string, content?: string) => Promise<void>;
  onRescan?: () => void;
  onImportPdf?: () => void;
  onImportLink?: (link: string) => void;
  onRevealInSystem?: (path?: string) => Promise<void> | void;
  onOpenTerminal?: (path?: string) => Promise<void> | void;
  t: TranslationFn;
}) {
  const {
    mode = "workspace",
    tree,
    selectedPath,
    dirtyByPath,
    gitDecorations,
    allowRescan,
    busy,
    onSelect,
    onAction,
    onRescan,
    onImportPdf,
    onImportLink,
    onRevealInSystem,
    onOpenTerminal,
    t,
  } = props;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<ExplorerMenuTarget | null>(null);
  const [editing, setEditing] = useState<EditingState>(null);
  const [transferPanel, setTransferPanel] = useState<MoveCopyPanel>(null);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>(selectedPath ? [selectedPath] : []);
  const [selectionAnchorPath, setSelectionAnchorPath] = useState<string | null>(selectedPath);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const submitLockRef = useRef(false);
  const skipCreateBlurSubmitRef = useRef(false);
  useEffect(() => {
    const closeMenuOnOutside = (event: MouseEvent) => {
      if (event.button === 2) {
        return;
      }
      const target = event.target as Node | null;
      if (menuRef.current && target && menuRef.current.contains(target)) {
        return;
      }
      if (rootRef.current && target && rootRef.current.contains(target)) {
        return;
      }
      setMenu(null);
    };
    const closeMenuOnBlur = () => setMenu(null);
    window.addEventListener("mousedown", closeMenuOnOutside);
    window.addEventListener("blur", closeMenuOnBlur);
    return () => {
      window.removeEventListener("mousedown", closeMenuOnOutside);
      window.removeEventListener("blur", closeMenuOnBlur);
    };
  }, []);
  const expandedMap = useMemo(() => {
    if (Object.keys(expanded).length > 0) {
      return expanded;
    }
    const defaults: Record<string, boolean> = {};
    const walk = (nodes: ResourceNode[]) => {
      for (const node of nodes) {
        if (shouldAutoExpandNode(node)) {
          defaults[node.relativePath] = true;
          walk(node.children);
        }
      }
    };
    walk(tree);
    return defaults;
  }, [expanded, tree]);
  const visibleFilePaths = useMemo(
    () => collectVisibleFilePaths(tree, expandedMap),
    [expandedMap, tree],
  );
  useEffect(() => {
    if (!selectedPath) {
      setSelectedPaths([]);
      setSelectionAnchorPath(null);
      return;
    }
    setSelectedPaths((prev) => (prev.includes(selectedPath) ? prev : [selectedPath]));
    setSelectionAnchorPath(selectedPath);
  }, [selectedPath]);
  useEffect(() => {
    setSelectedPaths((prev) => prev.filter((path) => visibleFilePaths.includes(path)));
    setSelectionAnchorPath((prev) => (prev && visibleFilePaths.includes(prev) ? prev : null));
  }, [visibleFilePaths]);
  const triggerRename = (path: string, name: string) => {
    requestAnimationFrame(() => {
      setEditing({ mode: "rename", path, value: name });
    });
  };
  const triggerCreate = (parentPath: string, createMode: "create_file" | "create_folder") => {
    setEditing({ mode: createMode, parentPath, value: "" });
  };
  const submitEditing = async (valueOverride?: string) => {
    if (submitLockRef.current) {
      return;
    }
    submitLockRef.current = true;
    if (!onAction) {
      setEditing(null);
      submitLockRef.current = false;
      return;
    }
    const editingSnapshot = editing;
    if (!editingSnapshot) {
      submitLockRef.current = false;
      return;
    }
    const nextName = (valueOverride ?? editingSnapshot.value).trim();
    if (!nextName) {
      setEditing(null);
      submitLockRef.current = false;
      return;
    }
    try {
      if (editingSnapshot.mode === "rename") {
        const targetPath = joinPath(dirnameOf(editingSnapshot.path), nextName);
        await onAction("rename", editingSnapshot.path, targetPath);
        setEditing(null);
        return;
      }
      const path = joinPath(editingSnapshot.parentPath, nextName);
      if (editingSnapshot.mode === "create_file") {
        await onAction("create_file", path, undefined, "");
      } else {
        await onAction("create_folder", path);
      }
      setEditing(null);
    } finally {
      submitLockRef.current = false;
    }
  };
  const renderMenu = () => {
    if (!menu) {
      return null;
    }
    const items: Array<{ key: string; onClick: () => void }> = [];
    if (mode === "library") {
      items.push(
        {
          key: "library.action.importPdf",
          onClick: () => onImportPdf?.(),
        },
        {
          key: "library.action.importLink",
          onClick: () => {
            setLinkDraft("");
          },
        },
        {
          key: "explorer.action.newFolder",
          onClick: () => triggerCreate("", "create_folder"),
        },
      );
      if (allowRescan && onRescan) {
        items.push({
          key: "explorer.action.rescan",
          onClick: () => onRescan(),
        });
      }
    } else if (menu.kind === "blank") {
      items.push(
        {
          key: "explorer.action.newFile",
          onClick: () => triggerCreate("", "create_file"),
        },
        {
          key: "explorer.action.newFolder",
          onClick: () => triggerCreate("", "create_folder"),
        },
        {
          key: "explorer.action.revealInSystem",
          onClick: () => onRevealInSystem?.(""),
        },
        {
          key: "explorer.action.openTerminal",
          onClick: () => onOpenTerminal?.(""),
        },
      );
      if (allowRescan && onRescan) {
        items.push({
          key: "explorer.action.rescan",
          onClick: () => onRescan(),
        });
      }
    } else if (menu.kind === "directory") {
      if (mode === "workspace") {
        items.push({
          key: "explorer.action.newFile",
          onClick: () => triggerCreate(menu.path, "create_file"),
        });
      }
      items.push(
        {
          key: "explorer.action.newFolder",
          onClick: () => triggerCreate(menu.path, "create_folder"),
        },
        {
          key: "explorer.action.rename",
          onClick: () => {
            const parts = menu.path.split("/");
            const name = parts[parts.length - 1] ?? menu.path;
            triggerRename(menu.path, name);
          },
        },
        {
          key: "explorer.action.copy",
          onClick: () =>
            setTransferPanel({ action: "copy", sourcePath: menu.path, targetPath: menu.path }),
        },
        {
          key: "explorer.action.move",
          onClick: () =>
            setTransferPanel({ action: "move", sourcePath: menu.path, targetPath: menu.path }),
        },
        {
          key: "explorer.action.delete",
          onClick: () => onAction?.("delete", menu.path),
        },
      );
      if (mode === "workspace") {
        items.push(
          {
            key: "explorer.action.revealInSystem",
            onClick: () => onRevealInSystem?.(menu.path),
          },
          {
            key: "explorer.action.openTerminal",
            onClick: () => onOpenTerminal?.(menu.path),
          },
        );
      }
    } else {
      items.push(
        {
          key: "explorer.action.rename",
          onClick: () => {
            const parts = menu.path.split("/");
            const name = parts[parts.length - 1] ?? menu.path;
            triggerRename(menu.path, name);
          },
        },
        {
          key: "explorer.action.copy",
          onClick: () =>
            setTransferPanel({ action: "copy", sourcePath: menu.path, targetPath: menu.path }),
        },
        {
          key: "explorer.action.move",
          onClick: () =>
            setTransferPanel({ action: "move", sourcePath: menu.path, targetPath: menu.path }),
        },
        {
          key: "explorer.action.delete",
          onClick: () => onAction?.("delete", menu.path),
        },
      );
      if (mode === "workspace") {
        items.push(
          {
            key: "explorer.action.revealInSystem",
            onClick: () => onRevealInSystem?.(menu.path),
          },
          {
            key: "explorer.action.openTerminal",
            onClick: () => onOpenTerminal?.(menu.path),
          },
        );
      }
    }
    const menuContent = (
      <div
        ref={menuRef}
        className="fixed z-[260] min-w-40 overflow-hidden rounded-md border border-slate-300 bg-white py-1 shadow-lg"
        style={{ left: Math.max(8, Math.min(menu.x, (typeof window !== "undefined" ? window.innerWidth : menu.x) - 180)), top: Math.max(8, Math.min(menu.y, (typeof window !== "undefined" ? window.innerHeight : menu.y) - 220)) }}
      >
        {items.map((item) => (
          <button
            key={item.key}
            className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
            onClick={async (event) => {
              event.stopPropagation();
              setMenu(null);
              await item.onClick();
            }}
          >
            {t(item.key)}
          </button>
        ))}
      </div>
    );
    if (typeof document === "undefined") {
      return menuContent;
    }
    return createPortal(menuContent, document.body);
  };
  const renderCreateEditor = (parentPath: string) => {
    if (
      !editing ||
      (editing.mode !== "create_file" && editing.mode !== "create_folder") ||
      editing.parentPath !== parentPath
    ) {
      return null;
    }
    const icon =
      editing.mode === "create_folder" ? (
        <Folder className="h-3.5 w-3.5 shrink-0 text-slate-500" />
      ) : (
        <FileCode2 className="h-3.5 w-3.5 shrink-0 text-slate-500" />
      );
    return (
      <div className="flex items-center gap-1 rounded-md border border-primary-200 bg-primary-50 px-2 py-1">
        {icon}
        <input
          autoFocus
          className="w-full bg-transparent text-xs text-slate-700 outline-none"
          value={editing.value}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) =>
            setEditing((prev) => (prev ? { ...prev, value: event.target.value } : prev))
          }
          onKeyDown={async (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              await submitEditing(event.currentTarget.value);
            }
            if (event.key === "Escape") {
              skipCreateBlurSubmitRef.current = true;
              setEditing(null);
            }
          }}
          onBlur={() => {
            if (skipCreateBlurSubmitRef.current) {
              skipCreateBlurSubmitRef.current = false;
              return;
            }
            void submitEditing(editing.value);
          }}
        />
      </div>
    );
  };
  const renderNode = (node: ResourceNode, depth: number) => {
    const isDirectory = node.kind === "directory";
    const isExpanded = isDirectory ? expandedMap[node.relativePath] !== false : false;
    const isRenaming = editing?.mode === "rename" && editing.path === node.relativePath;
    const isDirty = !isDirectory && mode === "workspace" && Boolean(dirtyByPath?.[node.relativePath]);
    const isSelected = !isDirectory && selectedPaths.includes(node.relativePath);
    const decoration = !isDirectory ? gitDecorations?.[node.relativePath] : undefined;
    const isIgnored = Boolean(decoration?.ignored);
    const decorationTone = resolveDecorationTone(decoration);
    const indentStyle = { paddingLeft: `${depth * 10}px` };
    return (
      <Fragment key={node.relativePath}>
        <div
          data-explorer-node="true"
          className={cn(
            "group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition",
            isSelected
              ? "bg-primary-100 text-primary-900"
              : isIgnored
                ? "explorer-node-muted hover:bg-slate-100 hover:text-slate-700"
                : "explorer-node-fg hover:bg-slate-100 hover:text-slate-900",
          )}
          aria-selected={!isDirectory && isSelected}
          style={indentStyle}
          draggable={!isDirectory}
          title={node.relativePath}
          onDragStart={(event) => {
            if (isDirectory) return;
            event.dataTransfer.effectAllowed = "copy";
            event.dataTransfer.setData("application/x-latotex-path", node.relativePath);
            event.dataTransfer.setData("text/plain", node.relativePath);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setMenu({
              x: event.clientX,
              y: event.clientY,
              path: node.relativePath,
              kind: node.kind,
            });
          }}
          onClick={(event) => {
            if (isDirectory) {
              setExpanded((prev) => ({ ...prev, [node.relativePath]: !isExpanded }));
              return;
            }
            const nextSelection = resolveExplorerSelection({
              current: selectedPaths,
              anchorPath: selectionAnchorPath,
              targetPath: node.relativePath,
              visibleFilePaths,
              range: event.shiftKey,
              toggle: event.ctrlKey || event.metaKey,
            });
            setSelectedPaths(nextSelection.nextSelectedPaths);
            setSelectionAnchorPath(nextSelection.nextAnchorPath);
            onSelect(node.relativePath);
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (mode === "workspace" && node.kind === "file") triggerRename(node.relativePath, node.name);
          }}
        >
          {isDirectory ? (
            <>
                <ChevronRight
                  className={cn(
                  "explorer-node-muted h-3.5 w-3.5 shrink-0 transition-transform",
                  isExpanded && "rotate-90",
                )}
              />
              {isExpanded ? (
                <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <Folder className="h-3.5 w-3.5 shrink-0" />
              )}
            </>
          ) : (
            <>
              <span className="h-3.5 w-3.5 shrink-0" />
              <FileCode2
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  decoration ? decorationTone.iconClass : "explorer-node-muted",
                )}
              />
            </>
          )}
          {isRenaming ? (
            <input
              autoFocus
              className="w-full bg-transparent text-xs text-slate-800 outline-none"
              value={editing.value}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) =>
                setEditing((prev) => (prev ? { ...prev, value: event.target.value } : prev))
              }
              onKeyDown={async (event) => {
                if (event.key === "Enter") {
                  await submitEditing(event.currentTarget.value);
                }
                if (event.key === "Escape") {
                  setEditing(null);
                }
              }}
              onBlur={() => setEditing(null)}
            />
          ) : (
            <>
              <span
                className={cn(
                  "truncate",
                  isIgnored && "opacity-80",
                  decoration ? decorationTone.textClass : undefined,
                )}
              >
                {node.name}
              </span>
              {isDirty ? (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400"
                  title={t("editor.unsaved.title")}
                  aria-label={t("editor.unsaved.title")}
                />
              ) : null}
              {!isDirectory && decoration ? (
                <span
                  className={cn(
                    "ml-auto rounded border px-1 py-0 text-[9px] font-mono",
                    decoration.ignored
                      ? "border-slate-300 bg-slate-100 text-slate-500"
                      : decoration.code === "A" || decoration.code === "U"
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : decoration.code === "D"
                          ? "border-rose-300 bg-rose-50 text-rose-700"
                          : decoration.code === "R"
                            ? "border-sky-300 bg-sky-50 text-sky-700"
                            : "border-amber-300 bg-amber-50 text-amber-700",
                  )}
                >
                  {decoration.code}
                </span>
              ) : null}
            </>
          )}
        </div>
        {isDirectory && isExpanded && (
          <div className="space-y-1">
            {node.children.map((child) => renderNode(child, depth + 1))}
            {renderCreateEditor(node.relativePath)}
          </div>
        )}
      </Fragment>
    );
  };
  return (
    <div
      ref={rootRef}
      className="relative flex h-full min-h-0 flex-col"
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY, path: "", kind: "blank" });
      }}
    >
      <div
        className="min-h-0 flex-1 space-y-1 overflow-auto px-2"
        onDoubleClick={(event) => {
          if (mode !== "workspace" || editing) {
            return;
          }
          const target = event.target as HTMLElement | null;
          if (target?.closest("[data-explorer-node='true']")) {
            return;
          }
          triggerCreate("", "create_file");
        }}
      >
        {tree.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <Files className="h-4 w-4" />
              <span>{mode === "library" ? t("library.empty") : t("explorer.empty")}</span>
            </div>
          </div>
        ) : (
          <>
            {tree.map((node) => renderNode(node, 0))}
            {renderCreateEditor("")}
          </>
        )}
      </div>
      {transferPanel && (
        <ExplorerTransferPanel
          busy={busy}
          sourcePath={transferPanel.sourcePath}
          targetPath={transferPanel.targetPath}
          onTargetPathChange={(value) =>
            setTransferPanel((prev) => (prev ? { ...prev, targetPath: value } : prev))
          }
          onCancel={() => setTransferPanel(null)}
          onConfirm={async () => {
            await onAction?.(
              transferPanel.action,
              transferPanel.sourcePath,
              transferPanel.targetPath.trim(),
            );
            setTransferPanel(null);
          }}
          t={t}
        />
      )}
      {mode === "library" && linkDraft !== null && (
        <ExplorerLinkDraftPanel
          busy={busy}
          value={linkDraft}
          onChange={setLinkDraft}
          onCancel={() => setLinkDraft(null)}
          onConfirm={() => {
            onImportLink?.(linkDraft.trim());
            setLinkDraft(null);
          }}
          t={t}
        />
      )}
      {renderMenu()}
    </div>
  );
}
