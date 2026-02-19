import { Check, ChevronRight, FileCode2, Files, Folder, FolderOpen, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import type { FsAction, ResourceNode } from "../../shared/types/app";

type ExplorerMenuTarget = {
  x: number;
  y: number;
  path: string;
  kind: "file" | "directory" | "blank";
};

type EditingState =
  | { mode: "rename"; path: string; value: string }
  | { mode: "create_file" | "create_folder"; parentPath: string; value: string }
  | null;

type MoveCopyPanel =
  | { action: "copy" | "move"; sourcePath: string; targetPath: string }
  | null;

type TranslationFn = (key: any) => string;

function dirnameOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function joinPath(parent: string, name: string): string {
  if (!parent) {
    return name;
  }
  return `${parent}/${name}`;
}

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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

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
        if (node.kind === "directory") {
          defaults[node.relativePath] = true;
          walk(node.children);
        }
      }
    };
    walk(tree);
    return defaults;
  }, [expanded, tree]);

  const triggerRename = (path: string, name: string) => {
    requestAnimationFrame(() => {
      setEditing({ mode: "rename", path, value: name });
    });
  };

  const triggerCreate = (parentPath: string, mode: "create_file" | "create_folder") => {
    setEditing({ mode, parentPath, value: "" });
  };

  const submitEditing = async () => {
    if (!onAction) {
      setEditing(null);
      return;
    }
    if (!editing) {
      return;
    }
    const nextName = editing.value.trim();
    if (!nextName) {
      setEditing(null);
      return;
    }

    if (editing.mode === "rename") {
      const targetPath = joinPath(dirnameOf(editing.path), nextName);
      await onAction("rename", editing.path, targetPath);
      setEditing(null);
      return;
    }

    const path = joinPath(editing.parentPath, nextName);
    if (editing.mode === "create_file") {
      await onAction("create_file", path, undefined, "");
    } else {
      await onAction("create_folder", path);
    }
    setEditing(null);
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
      items.push(
        { key: "explorer.action.newFile", onClick: () => triggerCreate(menu.path, "create_file") },
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
        {
          key: "explorer.action.revealInSystem",
          onClick: () => onRevealInSystem?.(menu.path),
        },
        {
          key: "explorer.action.openTerminal",
          onClick: () => onOpenTerminal?.(menu.path),
        },
      );
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

    return (
      <div
        ref={menuRef}
        className="fixed z-50 min-w-40 overflow-hidden rounded-md border border-slate-300 bg-white py-1 shadow-lg"
        style={{ left: menu.x, top: menu.y }}
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
  };

  const renderCreateEditor = (parentPath: string) => {
    if (mode !== "workspace") {
      return null;
    }
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
              await submitEditing();
            }
            if (event.key === "Escape") {
              setEditing(null);
            }
          }}
          onBlur={() => setEditing(null)}
        />
      </div>
    );
  };

  const renderNode = (node: ResourceNode, depth: number) => {
    const isDirectory = node.kind === "directory";
    const isExpanded = isDirectory ? expandedMap[node.relativePath] !== false : false;
    const isRenaming = editing?.mode === "rename" && editing.path === node.relativePath;
    const isDirty = !isDirectory && mode === "workspace" && Boolean(dirtyByPath?.[node.relativePath]);
    const decoration = !isDirectory ? gitDecorations?.[node.relativePath] : undefined;
    const isIgnored = Boolean(decoration?.ignored);
    const indentStyle = { paddingLeft: `${depth * 10}px` };
    return (
      <Fragment key={node.relativePath}>
        <div
          className={cn(
            "group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition",
            selectedPath === node.relativePath
              ? "bg-primary-100 text-primary-900"
              : isIgnored
                ? "text-slate-400 hover:bg-slate-100 hover:text-slate-500"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
          )}
          style={indentStyle}
          title={node.relativePath}
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
          onClick={() => {
            if (isDirectory) {
              setExpanded((prev) => ({ ...prev, [node.relativePath]: !isExpanded }));
            }
            onSelect(node.relativePath);
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (mode === "workspace" && node.kind === "file") {
              triggerRename(node.relativePath, node.name);
            }
          }}
        >
          {isDirectory ? (
            <>
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform",
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
              <FileCode2 className="h-3.5 w-3.5 shrink-0" />
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
                  await submitEditing();
                }
                if (event.key === "Escape") {
                  setEditing(null);
                }
              }}
              onBlur={() => setEditing(null)}
            />
          ) : (
            <>
              <span className={cn("truncate", isIgnored && "opacity-80")}>{node.name}</span>
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
      onDoubleClick={(event) => {
        if (mode !== "workspace") {
          return;
        }
        if (event.target !== event.currentTarget) {
          return;
        }
        triggerCreate("", "create_file");
      }}
    >
      <div className="min-h-0 flex-1 space-y-1 overflow-auto pr-1">
        {tree.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
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

      {mode === "workspace" && transferPanel && (
        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
          <div className="truncate text-slate-600">{transferPanel.sourcePath}</div>
          <input
            className="mt-2 w-full rounded border border-slate-300 bg-white px-2 py-1 outline-none focus:border-primary-500"
            value={transferPanel.targetPath}
            placeholder={t("explorer.prompt.targetPath")}
            onChange={(event) =>
              setTransferPanel((prev) =>
                prev ? { ...prev, targetPath: event.target.value } : prev,
              )
            }
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-600 hover:bg-slate-100"
              onClick={() => setTransferPanel(null)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <button
              className="rounded border border-primary-600 bg-primary-600 px-2 py-1 text-white hover:bg-primary-500 disabled:opacity-50"
              disabled={busy || !transferPanel.targetPath.trim()}
              onClick={async () => {
                await onAction?.(
                  transferPanel.action,
                  transferPanel.sourcePath,
                  transferPanel.targetPath.trim(),
                );
                setTransferPanel(null);
              }}
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
      {mode === "library" && linkDraft !== null && (
        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
          <div className="text-slate-600">{t("library.action.importLink")}</div>
          <input
            className="mt-2 w-full rounded border border-slate-300 bg-white px-2 py-1 outline-none focus:border-primary-500"
            value={linkDraft}
            placeholder={t("library.linkPlaceholder")}
            onChange={(event) => setLinkDraft(event.target.value)}
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-600 hover:bg-slate-100"
              onClick={() => setLinkDraft(null)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <button
              className="rounded border border-primary-600 bg-primary-600 px-2 py-1 text-white hover:bg-primary-500 disabled:opacity-50"
              disabled={busy || !linkDraft.trim()}
              onClick={() => {
                onImportLink?.(linkDraft.trim());
                setLinkDraft(null);
              }}
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
      {renderMenu()}
    </div>
  );
}
