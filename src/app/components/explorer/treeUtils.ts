export type ExplorerMenuTarget = {
  x: number;
  y: number;
  path: string;
  kind: "file" | "directory" | "blank";
};

export type EditingState =
  | { mode: "rename"; path: string; value: string }
  | { mode: "create_file" | "create_folder"; parentPath: string; value: string }
  | null;

export type MoveCopyPanel =
  | { action: "copy" | "move"; sourcePath: string; targetPath: string }
  | null;

export function dirnameOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

export function joinPath(parent: string, name: string): string {
  if (!parent) {
    return name;
  }
  return `${parent}/${name}`;
}

export function resolveDecorationTone(decoration: { code: string; ignored: boolean } | undefined) {
  if (!decoration) {
    return {
      textClass: "text-slate-700",
      iconClass: "text-slate-500",
    };
  }
  if (decoration.ignored) {
    return {
      textClass: "text-slate-400",
      iconClass: "text-slate-400",
    };
  }
  if (decoration.code === "A" || decoration.code === "U") {
    return {
      textClass: "text-emerald-700",
      iconClass: "text-emerald-600",
    };
  }
  if (decoration.code === "D") {
    return {
      textClass: "text-rose-700",
      iconClass: "text-rose-600",
    };
  }
  if (decoration.code === "R") {
    return {
      textClass: "text-sky-700",
      iconClass: "text-sky-600",
    };
  }
  return {
    textClass: "text-amber-700",
    iconClass: "text-amber-600",
  };
}
