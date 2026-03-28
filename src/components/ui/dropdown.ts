import { type RefObject, useEffect } from "react";
import { cn } from "../../lib/utils";

export function useDropdownDismiss(params: {
  open: boolean;
  rootRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const { open, rootRef, onClose } = params;

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (rootRef.current && target && rootRef.current.contains(target)) {
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
  }, [onClose, open, rootRef]);
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
