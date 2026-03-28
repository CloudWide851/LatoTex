import { Check } from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/utils";

export type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, ...props }, ref) => (
    <span className="settings-checkbox relative inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        className={cn(
          "settings-checkbox__input peer m-0 h-[22px] w-[22px] cursor-pointer appearance-none rounded-[7px] border-[1.5px] outline-none transition",
          "hover:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-200 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
      <Check className="settings-checkbox__icon pointer-events-none absolute z-20 h-[13px] w-[13px] stroke-[3.2] opacity-0 transition peer-checked:opacity-100" />
    </span>
  ),
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
