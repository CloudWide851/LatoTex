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
    "z-[240] overflow-auto rounded-lg border border-slate-300 bg-white shadow-[0_18px_44px_rgba(15,23,42,0.18)]",
    extraClassName,
  );
}

export function dropdownItemClassName(extraClassName?: string) {
  return cn(
    "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-slate-700 transition hover:bg-slate-100",
    extraClassName,
  );
}
