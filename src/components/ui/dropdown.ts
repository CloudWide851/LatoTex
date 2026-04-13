import { type CSSProperties, type RefObject, useEffect } from "react";
import { cn } from "../../lib/utils";

export function useDropdownDismiss(params: {
  open: boolean;
  rootRef: RefObject<HTMLElement | null>;
  includeRefs?: Array<RefObject<HTMLElement | null>>;
  onClose: () => void;
}) {
  const { open, rootRef, includeRefs = [], onClose } = params;

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (rootRef.current?.contains(target)) {
        return;
      }
      if (includeRefs.some((ref) => ref.current?.contains(target))) {
        return;
      }
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [includeRefs, onClose, open, rootRef]);
}

export function dropdownSurfaceClassName(extraClassName?: string) {
  return cn(
    "control-menu-surface z-[450] overflow-auto p-1.5 motion-card-pop motion-overlay-enter",
    extraClassName,
  );
}

export function dropdownItemClassName(extraClassName?: string) {
  return cn(
    "control-menu-item flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs",
    "focus-visible:outline-none",
    extraClassName,
  );
}

export function dropdownTriggerClassName(extraClassName?: string) {
  return cn(
    "control-surface inline-flex items-center gap-2 px-3 text-sm font-medium text-[color:var(--control-text)]",
    "focus-visible:outline-none",
    extraClassName,
  );
}

export function dropdownSearchRowClassName(extraClassName?: string) {
  return cn("control-menu-search flex items-center gap-2 px-2.5", extraClassName);
}

export function dropdownSearchInputClassName(extraClassName?: string) {
  return cn(
    "control-menu-input h-full w-full border-none bg-transparent text-xs outline-none",
    extraClassName,
  );
}

export function dropdownIconButtonClassName(extraClassName?: string) {
  return cn(
    "control-surface inline-flex items-center justify-center rounded-[12px] p-0 text-[color:var(--control-muted)]",
    "focus-visible:outline-none",
    extraClassName,
  );
}

export function buildFloatingSurfaceStyle(
  trigger: HTMLElement,
  options?: {
    align?: "start" | "end" | "center";
    minWidth?: number;
    preferredWidth?: number;
    maxWidth?: number;
    offset?: number;
    desiredHeight?: number;
  },
): CSSProperties {
  if (typeof window === "undefined") {
    return {};
  }

  const rect = trigger.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const minWidth = Math.max(140, options?.minWidth ?? rect.width);
  const viewportMaxWidth = Math.max(minWidth, viewportWidth - 24);
  const maxWidth = Math.min(
    Math.max(minWidth, options?.maxWidth ?? viewportMaxWidth),
    viewportMaxWidth,
  );
  const preferredWidth = Math.min(
    Math.max(minWidth, options?.preferredWidth ?? rect.width),
    maxWidth,
  );
  const align = options?.align ?? "start";
  const offset = options?.offset ?? 8;
  const desiredHeight = Math.max(160, options?.desiredHeight ?? 240);

  let alignedLeft = rect.left;
  if (align === "end") {
    alignedLeft = rect.right - preferredWidth;
  } else if (align === "center") {
    alignedLeft = rect.left + ((rect.width - preferredWidth) / 2);
  }

  const maxLeft = Math.max(12, viewportWidth - preferredWidth - 12);
  const left = Math.min(Math.max(12, alignedLeft), maxLeft);
  const spaceBelow = viewportHeight - rect.bottom - 12;
  const spaceAbove = rect.top - 12;
  const renderAbove = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
  const top = renderAbove
    ? Math.max(12, rect.top - offset - Math.min(desiredHeight, Math.max(160, spaceAbove)))
    : Math.min(rect.bottom + offset, viewportHeight - 72);
  const maxHeight = renderAbove
    ? Math.max(160, rect.top - 20)
    : Math.max(160, viewportHeight - top - 16);

  return {
    position: "fixed",
    left,
    top,
    width: preferredWidth,
    maxHeight,
  };
}
