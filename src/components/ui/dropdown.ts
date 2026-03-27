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
    "z-[450] overflow-auto rounded-xl border border-slate-300/90 bg-white/95 p-0 backdrop-blur-sm",
    "shadow-[0_16px_42px_rgba(15,23,42,0.2),0_1px_0_rgba(255,255,255,0.7)_inset]",
    "origin-top motion-fade-in",
    extraClassName,
  );
}

export function dropdownItemClassName(extraClassName?: string) {
  return cn(
    "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-slate-700 transition duration-150",
    "hover:bg-slate-100 hover:text-slate-900 focus-visible:bg-slate-100 focus-visible:text-slate-900",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-200",
    extraClassName,
  );
}
