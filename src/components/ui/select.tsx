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
          "w-full appearance-none rounded-lg border px-3 pr-9 font-medium leading-none outline-none transition-all duration-200",
          "[&>option]:bg-white [&>option]:text-slate-800 [&>option]:py-2",
          uiSize === "sm" ? "h-8 text-xs" : "h-10 text-sm",
          tone === "dark"
            ? "border-slate-600 bg-slate-900 text-slate-100 shadow-lg hover:border-slate-500 hover:shadow-xl focus:border-primary-500 focus:ring-2 focus:ring-primary-500/40 focus:shadow-xl"
            : "border-slate-300 bg-white text-slate-800 shadow-sm hover:border-slate-400 hover:shadow-md focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:shadow-md",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className={cn(
          "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 transition-all duration-200",
          uiSize === "sm" ? "h-3.5 w-3.5" : "h-4 w-4",
          tone === "dark"
            ? "text-slate-400 group-hover:text-slate-300 group-focus-within:text-primary-400"
            : "text-slate-500 group-hover:text-slate-700 group-focus-within:text-primary-600",
        )}
      />
    </div>
  ),
);
Select.displayName = "Select";

export { Select };
