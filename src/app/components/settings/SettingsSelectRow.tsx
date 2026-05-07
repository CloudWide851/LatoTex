import { Select } from "../../../components/ui/select";
import { cn } from "../../../lib/utils";

export function SettingsSelectRow(props: {
  title: string;
  value: string;
  description?: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  className?: string;
}) {
  const { title, value, description, options, onChange, className } = props;

  return (
    <div className={cn("rounded-lg border border-slate-200 p-4", className)}>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,190px)_minmax(0,220px)_minmax(0,1fr)] lg:items-center">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <Select
          value={value}
          wrapperClassName="w-full max-w-full"
          portalClassName="settings-scrollbar-hidden"
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        {description ? <p className="text-xs leading-5 text-slate-500">{description}</p> : <div />}
      </div>
    </div>
  );
}
