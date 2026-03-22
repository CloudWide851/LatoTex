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
          "w-full appearance-none rounded-lg border px-3 pr-9 font-medium leading-none outline-none transition duration-150 ease-out",
          uiSize === "sm" ? "h-8 text-xs" : "h-10 text-sm",
          tone === "dark"
            ? "border-slate-600 bg-gradient-to-b from-slate-900 to-slate-950 text-slate-100 shadow-[0_12px_24px_rgba(2,6,23,0.34)] hover:border-slate-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-500/30"
            : "border-slate-300 bg-gradient-to-b from-white to-slate-50 text-slate-800 shadow-[0_1px_0_rgba(255,255,255,0.5),0_12px_24px_rgba(15,23,42,0.11)] hover:border-slate-400 hover:shadow-[0_1px_0_rgba(255,255,255,0.5),0_14px_28px_rgba(15,23,42,0.14)] focus:border-primary-500 focus:ring-2 focus:ring-primary-200",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className={cn(
          "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 transition",
          uiSize === "sm" ? "h-3.5 w-3.5" : "h-4 w-4",
          tone === "dark"
            ? "text-zinc-400 group-hover:text-zinc-300"
            : "text-slate-500 group-hover:text-slate-600",
          "group-focus-within:text-primary-500",
        )}
      />
    </div>
  ),
);
Select.displayName = "Select";

export { Select };
