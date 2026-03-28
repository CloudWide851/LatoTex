import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  tone?: "light" | "dark";
  uiSize?: "default" | "sm";
  wrapperClassName?: string;
};

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, wrapperClassName, children, tone = "light", uiSize = "default", ...props }, ref) => (
    <div className={cn("group relative w-full", wrapperClassName)}>
      <select
        ref={ref}
        className={cn(
          "control-surface w-full appearance-none font-medium leading-none outline-none",
          "[&>option]:bg-white [&>option]:text-slate-800",
          uiSize === "sm" ? "h-8 rounded-[12px] px-3 pr-9 text-xs" : "h-10 px-3.5 pr-10 text-sm",
          tone === "dark" && "[color-scheme:dark]",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className={cn(
          "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--control-muted)] transition-all duration-200",
          uiSize === "sm" ? "h-3.5 w-3.5" : "h-4 w-4",
          "group-hover:text-[color:var(--control-text)] group-focus-within:-translate-y-[55%] group-focus-within:text-primary-600",
        )}
      />
    </div>
  ),
);
Select.displayName = "Select";

export { Select };
