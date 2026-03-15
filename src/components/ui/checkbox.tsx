import { Check } from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/utils";

export type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, ...props }, ref) => (
    <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        className={cn(
          "peer absolute inset-0 z-10 m-0 cursor-pointer appearance-none rounded-md border border-slate-300 bg-white outline-none transition",
          "hover:border-slate-400 focus-visible:ring-2 focus-visible:ring-primary-200 disabled:cursor-not-allowed disabled:opacity-50",
          "checked:border-primary-600 checked:bg-primary-600",
          className,
        )}
        {...props}
      />
      <Check className="pointer-events-none absolute z-20 h-3.5 w-3.5 text-white opacity-0 transition peer-checked:opacity-100" />
    </span>
  ),
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
