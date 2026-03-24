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
      onCheckedChange(!checked);
    }
  };

  return (
    <div
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      className={cn(
        "flex cursor-pointer select-none items-center justify-between rounded-lg border border-slate-200 p-4 text-sm text-slate-700 outline-none transition focus-visible:ring-2 focus-visible:ring-primary-200",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
      onClick={toggle}
      onKeyDown={handleKeyDown}
    >
      <span className={cn("pr-3", textClassName)}>{label}</span>
      <Checkbox
        checked={checked}
        disabled={disabled}
        className={checkboxClassName}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
    </div>
  );
}
