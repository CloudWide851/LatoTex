import { Pencil, RefreshCw, X, XCircle } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TranslationFn } from "./terminalTypes";
import { cspStyle } from "../../../shared/ui/cspStyle";

const MENU_MARGIN = 8;

function clampPosition(x: number, y: number, width: number, height: number) {
  if (typeof window === "undefined") {
    return { x, y };
  }
  return {
    x: Math.max(MENU_MARGIN, Math.min(x, window.innerWidth - width - MENU_MARGIN)),
    y: Math.max(MENU_MARGIN, Math.min(y, window.innerHeight - height - MENU_MARGIN)),
  };
}

export function TerminalSessionContextMenu(props: {
  x: number;
  y: number;
  canCloseOthers: boolean;
  onRename: () => void;
  onRestart: () => void;
  onCloseSession: () => void;
  onCloseOthers: () => void;
  onClose: () => void;
  t: TranslationFn;
}) {
  const {
    x,
    y,
    canCloseOthers,
    onRename,
    onRestart,
    onCloseSession,
    onCloseOthers,
    onClose,
    t,
  } = props;
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState(() => clampPosition(x, y, 184, 176));

  useLayoutEffect(() => {
    const rect = menuRef.current?.getBoundingClientRect();
    if (rect) {
      setPosition(clampPosition(x, y, rect.width, rect.height));
    }
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y]);

  useEffect(() => {
    const closeFromPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) {
        return;
      }
      onClose();
    };
    const closeFromKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("pointerdown", closeFromPointer);
    window.addEventListener("keydown", closeFromKey);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("pointerdown", closeFromPointer);
      window.removeEventListener("keydown", closeFromKey);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  const run = (action: () => void) => {
    onClose();
    action();
  };
  const itemClass = "flex min-h-8 w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-[color:var(--control-text)] outline-none hover:bg-[color:var(--control-surface-hover-top)] focus-visible:bg-[color:var(--control-surface-hover-top)] disabled:cursor-not-allowed disabled:opacity-40";

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="app-material-floating fixed z-[320] min-w-44 overflow-hidden rounded-md border py-1 shadow-lg"
      {...cspStyle({ left: position.x, top: position.y })}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" role="menuitem" className={itemClass} onClick={() => run(onRename)}>
        <Pencil className="h-3.5 w-3.5 shrink-0" />
        {t("terminal.rename")}
      </button>
      <button type="button" role="menuitem" className={itemClass} onClick={() => run(onRestart)}>
        <RefreshCw className="h-3.5 w-3.5 shrink-0" />
        {t("terminal.restart")}
      </button>
      <button type="button" role="menuitem" className={itemClass} onClick={() => run(onCloseSession)}>
        <X className="h-3.5 w-3.5 shrink-0" />
        {t("terminal.close")}
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        disabled={!canCloseOthers}
        onClick={() => run(onCloseOthers)}
      >
        <XCircle className="h-3.5 w-3.5 shrink-0" />
        {t("terminal.closeOthers")}
      </button>
    </div>,
    document.body,
  );
}
