import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

export function FlatCheckIndicator(props: {
  checked: boolean;
  className?: string;
}) {
  const { checked, className } = props;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition",
        checked
          ? "border-primary-600 bg-primary-600 text-white"
          : "border-slate-300 bg-white text-transparent",
        className,
      )}
    >
      <Check className="h-3 w-3 stroke-[3]" />
    </span>
  );
}
