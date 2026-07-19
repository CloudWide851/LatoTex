import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  Button as AriaButton,
  ListBox,
  ListBoxItem,
  Popover,
  Select as AriaSelect,
} from "react-aria-components";
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
  const target = { value, name: name ?? "" } as HTMLSelectElement;
  return { target, currentTarget: target } as SelectChangeEvent;
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
    id,
    placeholder,
    restoreFocusOnCommit: _restoreFocusOnCommit = true,
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
    const hiddenSelectRef = React.useRef<HTMLSelectElement | null>(null);
    const activeValue = isControlled ? String(value ?? "") : internalValue;
    const selectedOption = options.find((option) => option.value === activeValue) ?? null;
    const selectedLabel = selectedOption?.label || String(placeholder || "");
    const accessibleLabel = props["aria-label"] || props.title || name || placeholder || selectedLabel;

    React.useImperativeHandle(ref, () => hiddenSelectRef.current as HTMLSelectElement, []);

    React.useEffect(() => {
      if (!isControlled) {
        setInternalValue(initialValue);
      }
    }, [initialValue, isControlled]);

    const commitValue = React.useCallback((nextValue: string) => {
      if (!isControlled) {
        setInternalValue(nextValue);
      }
      onChange?.(synthesizeChangeEvent(nextValue, name));
    }, [isControlled, name, onChange]);

    const triggerClassName = cn(
      "control-surface control-select-trigger group inline-flex w-full items-center justify-between gap-2 font-medium leading-none outline-none",
      uiSize === "sm" ? "h-8 rounded-[12px] px-3 pr-2.5 text-xs" : "h-10 rounded-[15px] px-3.5 pr-3 text-sm",
      tone === "dark" && "[color-scheme:dark]",
      disabled && "cursor-not-allowed opacity-60",
      className,
    );

    return (
      <div className={cn("relative w-full", wrapperClassName)}>
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
        <AriaSelect
          id={id}
          aria-label={accessibleLabel}
          aria-labelledby={props["aria-labelledby"]}
          aria-describedby={props["aria-describedby"]}
          selectedKey={activeValue}
          isDisabled={disabled}
          isRequired={props.required}
          onSelectionChange={(key) => commitValue(String(key))}
        >
          <AriaButton className={triggerClassName}>
            <span className={cn("truncate text-left", !selectedOption && "text-[color:var(--control-muted)]") }>
              {selectedLabel}
            </span>
            <ChevronDown
              className={cn(
                "pointer-events-none h-4 w-4 shrink-0 text-[color:var(--control-muted)] transition-transform duration-200",
                uiSize === "sm" && "h-3.5 w-3.5",
              )}
            />
          </AriaButton>
          <Popover
            {...portalAttributes}
            placement="bottom start"
            offset={8}
            className={cn(
              "control-select-portal z-[520] w-[var(--trigger-width)] min-w-40 outline-none",
              portalClassName,
            )}
          >
            <div className="control-menu-surface max-h-80 overflow-hidden p-1.5">
              <ListBox className="max-h-[inherit] overflow-auto pr-0.5 outline-none">
                {options.map((option) => (
                  <ListBoxItem
                    key={`${option.value}-${option.label}`}
                    id={option.value}
                    textValue={option.label || option.value}
                    isDisabled={option.disabled}
                    className={({ isSelected, isFocused, isDisabled }) => cn(
                      "control-menu-item flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left outline-none",
                      uiSize === "sm" ? "rounded-[12px] text-xs" : "rounded-[14px] text-sm",
                      isSelected && "control-menu-item--selected",
                      isFocused && "ring-2 ring-[color:var(--app-accent)] ring-inset",
                      isDisabled && "cursor-not-allowed opacity-45",
                    )}
                  >
                    {({ isSelected }) => (
                      <>
                        <span className="truncate">{option.label || option.value}</span>
                        <Check className={cn("h-3.5 w-3.5 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
                      </>
                    )}
                  </ListBoxItem>
                ))}
              </ListBox>
            </div>
          </Popover>
        </AriaSelect>
      </div>
    );
  },
);
Select.displayName = "Select";

export { Select };
