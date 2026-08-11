import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CircleAlert } from "lucide-react";
import { cn } from "../../lib/utils";
import { cspStyle } from "../../shared/ui/cspStyle";

export type InfoHintTone = "info" | "help" | "warning";

type InfoHintPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

const VIEWPORT_MARGIN = 12;
const SURFACE_OFFSET = 8;

const toneClass: Record<InfoHintTone, string> = {
  info: "text-[color:var(--app-muted)] hover:text-[color:var(--app-text)] focus-visible:text-[color:var(--app-text)]",
  help: "text-[color:var(--app-accent)] hover:opacity-80 focus-visible:opacity-80",
  warning: "text-[color:var(--app-status-warning)] hover:opacity-80 focus-visible:opacity-80",
};

export function resolveInfoHintPosition(input: {
  trigger: Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width">;
  popupHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}): InfoHintPosition {
  const { trigger, viewportWidth, viewportHeight } = input;
  const width = Math.max(1, Math.min(320, viewportWidth - (VIEWPORT_MARGIN * 2)));
  const centeredLeft = trigger.left + ((trigger.width - width) / 2);
  const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN);
  const left = Math.min(Math.max(VIEWPORT_MARGIN, centeredLeft), maxLeft);
  const maxHeight = Math.max(1, viewportHeight - (VIEWPORT_MARGIN * 2));
  const popupHeight = Math.min(Math.max(48, input.popupHeight || 120), maxHeight);
  const belowTop = trigger.bottom + SURFACE_OFFSET;
  const hasRoomBelow = belowTop + popupHeight <= viewportHeight - VIEWPORT_MARGIN;
  const top = hasRoomBelow
    ? belowTop
    : Math.max(VIEWPORT_MARGIN, trigger.top - SURFACE_OFFSET - popupHeight);
  return { left, top, width, maxHeight };
}

export function InfoHint(props: {
  content: string;
  label?: string;
  tone?: InfoHintTone;
  className?: string;
  popupClassName?: string;
}) {
  const { content, label, tone = "info", className, popupClassName } = props;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const popupId = useId();
  const descriptionId = useId();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<InfoHintPosition>({
    left: VIEWPORT_MARGIN,
    top: VIEWPORT_MARGIN,
    width: 240,
    maxHeight: 320,
  });

  const close = useCallback(() => {
    setPinned(false);
    setOpen(false);
  }, []);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === "undefined") return;
    setPosition(resolveInfoHintPosition({
      trigger: trigger.getBoundingClientRect(),
      popupHeight: popupRef.current?.getBoundingClientRect().height ?? 0,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }));
  }, []);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, content, updatePosition]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!triggerRef.current?.contains(target) && !popupRef.current?.contains(target)) {
        close();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        triggerRef.current?.focus();
        close();
      }
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("scroll", updatePosition, true);
    document.addEventListener("pointerdown", handlePointerDown);
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updatePosition);
    if (popupRef.current) observer?.observe(popupRef.current);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [close, open, updatePosition]);

  const popup = open && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={popupRef}
          id={popupId}
          role="tooltip"
          data-pinned={pinned ? "true" : "false"}
          className={cn(
            "app-material-floating fixed z-[440] overflow-auto whitespace-pre-line rounded-md border border-[color:var(--editor-widget-border)] px-3 py-2 text-xs leading-5 text-[color:var(--app-text)] shadow-lg motion-overlay-enter motion-reduce:animate-none motion-reduce:transition-none",
            popupClassName,
          )}
          {...cspStyle({ position: "fixed", ...position })}
        >
          {content}
        </div>,
        document.body,
      )
    : null;

  return (
    <span
      className={cn("inline-flex shrink-0 items-center", className)}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => {
        if (!pinned) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          "inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--control-primary-ring)] motion-reduce:transition-none",
          toneClass[tone],
        )}
        aria-label={label ?? content}
        aria-describedby={label ? descriptionId : undefined}
        aria-controls={popupId}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          if (!pinned) setOpen(false);
        }}
        onClick={() => {
          setPinned((current) => {
            const next = !current;
            setOpen(next);
            return next;
          });
        }}
      >
        <CircleAlert className="h-4 w-4" aria-hidden="true" />
      </button>
      {label ? <span id={descriptionId} className="sr-only">{content}</span> : null}
      {popup}
    </span>
  );
}
