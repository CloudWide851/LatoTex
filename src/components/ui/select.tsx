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
    <div className={cn("relative w-full", wrapperClassName)}>
      <select
        ref={ref}
        className={cn(
          "w-full appearance-none rounded-xl border px-3 pr-9 font-medium outline-none transition",
          uiSize === "sm" ? "h-8 text-xs" : "h-10 text-sm",
          tone === "dark"
            ? "border-slate-600 bg-slate-900/95 text-slate-100 shadow-[0_10px_22px_rgba(2,6,23,0.32)] hover:border-slate-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-500/30"
            : "border-slate-300 bg-white text-slate-800 shadow-[0_8px_20px_rgba(15,23,42,0.08)] hover:border-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className={cn(
          "pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2",
          tone === "dark" ? "text-zinc-400" : "text-slate-500"
        )}
      />
    </div>
  )
);
Select.displayName = "Select";

export { Select };
