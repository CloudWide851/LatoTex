import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

type SelectTone = "light" | "dark";
type SelectSize = "default" | "sm";

type OptionShape = {
  value: string;
  label: string;
  disabled: boolean;
};

type SelectPortalAttributes = Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className">
  & Partial<Record<`data-${string}`, string>>;

export type SelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  tone?: SelectTone;
  uiSize?: SelectSize;
  wrapperClassName?: string;
  placeholder?: string;
  restoreFocusOnCommit?: boolean;
  portalAttributes?: SelectPortalAttributes;
  portalClassName?: string;
};

type SelectChangeEvent = React.ChangeEvent<HTMLSelectElement>;

function collectOptions(children: React.ReactNode): OptionShape[] {
  const output: OptionShape[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) {
      return;
    }
    if (child.type === React.Fragment) {
      output.push(...collectOptions((child.props as { children?: React.ReactNode }).children));
      return;
    }
    if (typeof child.type === "string" && child.type.toLowerCase() === "option") {
      const optionProps = child.props as {
        children?: React.ReactNode;
        value?: string;
        disabled?: boolean;
      };
      const label = React.Children.toArray(optionProps.children)
        .map((value) => (typeof value === "string" || typeof value === "number" ? String(value) : ""))
        .join("")
        .trim();
      output.push({
        value: String(optionProps.value ?? ""),
        label,
        disabled: Boolean(optionProps.disabled),
      });
    }
  });
  return output;
}

function synthesizeChangeEvent(value: string, name?: string): SelectChangeEvent {
  const target = {
    value,
    name: name ?? "",
  } as HTMLSelectElement;
  return {
    target,
    currentTarget: target,
  } as SelectChangeEvent;
}

function buttonHeight(uiSize: SelectSize): number {
  return uiSize === "sm" ? 32 : 40;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({
    className,
    wrapperClassName,
    children,
    tone = "light",
    uiSize = "default",
    value,
    defaultValue,
    onChange,
    disabled,
    name,
    placeholder,
    restoreFocusOnCommit = true,
    portalAttributes,
    portalClassName,
    ...props
  }, ref) => {
    const options = React.useMemo(() => collectOptions(children), [children]);
    const isControlled = value !== undefined;
    const initialValue = React.useMemo(() => {
      if (value !== undefined) {
        return String(value ?? "");
      }
      if (defaultValue !== undefined) {
        return String(defaultValue ?? "");
      }
      return options.find((option) => !option.disabled)?.value ?? "";
    }, [defaultValue, options, value]);
    const [internalValue, setInternalValue] = React.useState(initialValue);
    const [open, setOpen] = React.useState(false);
    const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>({});
    const wrapperRef = React.useRef<HTMLDivElement | null>(null);
    const buttonRef = React.useRef<HTMLButtonElement | null>(null);
    const menuRef = React.useRef<HTMLDivElement | null>(null);
    const hiddenSelectRef = React.useRef<HTMLSelectElement | null>(null);
    const activeValue = isControlled ? String(value ?? "") : internalValue;
    const selectedOption = options.find((option) => option.value === activeValue) ?? options[0] ?? null;
    const selectedLabel = selectedOption?.label || String(placeholder || "");

    React.useImperativeHandle(ref, () => hiddenSelectRef.current as HTMLSelectElement, []);

    React.useEffect(() => {
      if (!isControlled) {
        setInternalValue(initialValue);
      }
    }, [initialValue, isControlled]);

    const updateMenuPosition = React.useCallback(() => {
      const button = buttonRef.current;
      if (!button || typeof window === "undefined") {
        return;
      }
      const rect = button.getBoundingClientRect();
      const width = Math.max(rect.width, uiSize === "sm" ? 156 : 188);
      const viewportWidth = window.innerWidth;
      const maxLeft = Math.max(12, viewportWidth - width - 12);
      const left = Math.min(Math.max(12, rect.left), maxLeft);
      const top = Math.min(rect.bottom + 8, window.innerHeight - 16 - buttonHeight(uiSize));
      setMenuStyle({
        position: "fixed",
        left,
        top,
        width,
        maxHeight: Math.min(window.innerHeight - top - 16, 320),
      });
    }, [uiSize]);

    React.useEffect(() => {
      if (!open) {
        return;
      }
      updateMenuPosition();
      const handleResize = () => updateMenuPosition();
      const handlePointerDown = (event: MouseEvent) => {
        const target = event.target as Node | null;
        if (wrapperRef.current?.contains(target)) {
          return;
        }
        if (menuRef.current?.contains(target)) {
          return;
        }
        setOpen(false);
      };
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          setOpen(false);
          buttonRef.current?.focus();
        }
      };
      window.addEventListener("resize", handleResize);
      window.addEventListener("scroll", handleResize, true);
      window.addEventListener("mousedown", handlePointerDown);
      window.addEventListener("keydown", handleKeyDown);
      return () => {
        window.removeEventListener("resize", handleResize);
        window.removeEventListener("scroll", handleResize, true);
        window.removeEventListener("mousedown", handlePointerDown);
        window.removeEventListener("keydown", handleKeyDown);
      };
    }, [open, updateMenuPosition]);

    const commitValue = React.useCallback((nextValue: string) => {
      if (!isControlled) {
        setInternalValue(nextValue);
      }
      onChange?.(synthesizeChangeEvent(nextValue, name));
      setOpen(false);
      if (restoreFocusOnCommit) {
        requestAnimationFrame(() => buttonRef.current?.focus());
      }
    }, [isControlled, name, onChange, restoreFocusOnCommit]);

    const cycleOption = React.useCallback((direction: 1 | -1) => {
      if (options.length === 0) {
        return;
      }
      const currentIndex = Math.max(0, options.findIndex((option) => option.value === activeValue));
      for (let offset = 1; offset <= options.length; offset += 1) {
        const index = (currentIndex + offset * direction + options.length) % options.length;
        const candidate = options[index];
        if (!candidate?.disabled) {
          commitValue(candidate.value);
          return;
        }
      }
    }, [activeValue, commitValue, options]);

    const triggerClassName = cn(
      "control-surface control-select-trigger group inline-flex w-full items-center justify-between gap-2 font-medium leading-none outline-none",
      uiSize === "sm" ? "h-8 rounded-[12px] px-3 pr-2.5 text-xs" : "h-10 rounded-[15px] px-3.5 pr-3 text-sm",
      tone === "dark" && "[color-scheme:dark]",
      disabled && "cursor-not-allowed opacity-60",
      className,
    );

    const menu = open && typeof document !== "undefined"
      ? createPortal(
          <div
            {...portalAttributes}
            ref={menuRef}
            className={cn("control-select-portal z-[520]", portalClassName)}
            style={menuStyle}
          >
            <div className="control-menu-surface overflow-hidden p-1.5">
              <div className="max-h-[inherit] overflow-auto pr-0.5">
                {options.map((option) => {
                  const selected = option.value === activeValue;
                  return (
                    <button
                      key={`${option.value}-${option.label}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      disabled={option.disabled}
                      className={cn(
                        "control-menu-item flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left",
                        uiSize === "sm" ? "rounded-[12px] text-xs" : "rounded-[14px] text-sm",
                        selected && "control-menu-item--selected",
                        option.disabled && "cursor-not-allowed opacity-45",
                      )}
                      onClick={() => commitValue(option.value)}
                    >
                      <span className="truncate">{option.label || option.value}</span>
                      <Check className={cn("h-3.5 w-3.5 shrink-0 transition", selected ? "opacity-100" : "opacity-0")} />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

    return (
      <div ref={wrapperRef} className={cn("relative w-full", wrapperClassName)}>
        <select
          {...props}
          ref={hiddenSelectRef}
          aria-hidden="true"
          tabIndex={-1}
          value={activeValue}
          name={name}
          disabled={disabled}
          className="pointer-events-none absolute inset-0 opacity-0"
          onChange={() => undefined}
        >
          {children}
        </select>
        <button
          ref={buttonRef}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-disabled={disabled}
          className={triggerClassName}
          disabled={disabled}
          onClick={() => setOpen((prev) => !prev)}
          onKeyDown={(event) => {
            if (disabled) {
              return;
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              if (!open) {
                setOpen(true);
                return;
              }
              cycleOption(1);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              if (!open) {
                setOpen(true);
                return;
              }
              cycleOption(-1);
              return;
            }
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setOpen((prev) => !prev);
            }
          }}
        >
          <span className={cn("truncate text-left", !selectedOption && "text-[color:var(--control-muted)]")}>
            {selectedLabel}
          </span>
          <ChevronDown
            className={cn(
              "pointer-events-none shrink-0 text-[color:var(--control-muted)] transition-all duration-200",
              uiSize === "sm" ? "h-3.5 w-3.5" : "h-4 w-4",
              open ? "-rotate-180 text-[color:var(--control-text)]" : "group-hover:text-[color:var(--control-text)]",
            )}
          />
        </button>
        {menu}
      </div>
    );
  },
);
Select.displayName = "Select";

export { Select };
