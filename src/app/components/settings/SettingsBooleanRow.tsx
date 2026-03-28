import type { KeyboardEvent } from "react";
import { Checkbox } from "../../../components/ui/checkbox";
import { cn } from "../../../lib/utils";

export function SettingsBooleanRow(props: {
  label: string;
  checked: boolean;
  onCheckedChange: (nextValue: boolean) => void;
  disabled?: boolean;
  className?: string;
  textClassName?: string;
  checkboxClassName?: string;
}) {
  const {
    label,
    checked,
    onCheckedChange,
    disabled = false,
    className,
    textClassName,
    checkboxClassName,
  } = props;

  const toggle = () => {
    if (disabled) {
      return;
    }
    onCheckedChange(!checked);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      toggle();
    }
  };

  return (
    <div
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      className={cn(
        "settings-bool-row flex cursor-pointer select-none items-center justify-between rounded-[18px] p-4 text-sm outline-none transition",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
      onClick={toggle}
      onKeyDown={handleKeyDown}
    >
      <span className={cn("pr-3 text-slate-700", textClassName)}>{label}</span>
      <div className="pointer-events-none">
        <Checkbox
          checked={checked}
          disabled={disabled}
          readOnly
          tabIndex={-1}
          className={checkboxClassName}
        />
      </div>
    </div>
  );
}
