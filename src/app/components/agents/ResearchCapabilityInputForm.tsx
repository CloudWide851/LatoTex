import { useMemo, useState } from "react";
import { Select } from "../../../components/ui/select";
import type { MessageKey } from "../../../i18n/messages/en-US/index";
import type { ResearchCapabilityDescriptor } from "../../../shared/types/researchAgent";

type TranslationFn = (key: MessageKey) => string;

type SchemaField = {
  type?: string;
  enum?: unknown[];
  description?: string;
  items?: { type?: string };
};

function parseInput(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function ResearchCapabilityInputForm(props: {
  descriptor: ResearchCapabilityDescriptor | undefined;
  inputText: string;
  disabled: boolean;
  onChange: (inputText: string) => void;
  t: TranslationFn;
}) {
  const { descriptor, inputText, disabled, onChange, t } = props;
  const [advanced, setAdvanced] = useState(false);
  const parsed = useMemo(() => parseInput(inputText), [inputText]);
  const properties = descriptor?.inputSchema.properties ?? {};
  const fields = Object.entries(properties) as Array<[string, SchemaField]>;
  const required = new Set(descriptor?.inputSchema.required ?? []);
  const updateField = (name: string, value: unknown) => {
    onChange(JSON.stringify({ ...(parsed ?? {}), [name]: value }, null, 2));
  };

  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-[color:var(--app-muted)]">{t("research.workbench.stepInputFields")}</span>
        <button
          type="button"
          className="text-[10px] font-medium text-[color:var(--app-accent)]"
          aria-expanded={advanced}
          onClick={() => setAdvanced((value) => !value)}
        >
          {t("research.workbench.stepInputAdvanced")}
        </button>
      </div>
      {!advanced && parsed && fields.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {fields.map(([name, field]) => {
            const value = parsed[name];
            const label = `${name}${required.has(name) ? " *" : ""}`;
            if (Array.isArray(field.enum)) {
              return (
                <label key={name} className="grid gap-1 text-[10px] text-[color:var(--app-muted)]">
                  <span>{label}</span>
                  <Select value={String(value ?? "")} disabled={disabled} onChange={(event) => updateField(name, event.currentTarget.value)}>
                    {field.enum.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
                  </Select>
                </label>
              );
            }
            if (field.type === "boolean") {
              return (
                <label key={name} className="app-material-inset flex min-h-9 items-center gap-2 rounded border px-2 text-[10px] text-[color:var(--app-text)]">
                  <input type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={(event) => updateField(name, event.currentTarget.checked)} />
                  {label}
                </label>
              );
            }
            if (field.type === "array") {
              return (
                <label key={name} className="grid gap-1 text-[10px] text-[color:var(--app-muted)] sm:col-span-2">
                  <span>{label}</span>
                  <textarea
                    className="app-material-inset min-h-16 resize-y rounded border px-2 py-1.5 text-[11px] text-[color:var(--app-text)] outline-none focus:border-[color:var(--app-accent)]"
                    value={Array.isArray(value) ? value.join("\n") : ""}
                    disabled={disabled}
                    onChange={(event) => updateField(name, event.currentTarget.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))}
                  />
                </label>
              );
            }
            return (
              <label key={name} className="grid gap-1 text-[10px] text-[color:var(--app-muted)]">
                <span>{label}</span>
                <input
                  className="app-material-inset h-8 rounded border px-2 text-[11px] text-[color:var(--app-text)] outline-none focus:border-[color:var(--app-accent)]"
                  type={field.type === "number" || field.type === "integer" ? "number" : "text"}
                  value={typeof value === "string" || typeof value === "number" ? value : ""}
                  disabled={disabled}
                  onChange={(event) => updateField(name, field.type === "number" || field.type === "integer"
                    ? Number(event.currentTarget.value)
                    : event.currentTarget.value)}
                />
              </label>
            );
          })}
        </div>
      ) : (
        <textarea
          className="app-material-inset min-h-24 w-full resize-y rounded-md border px-2 py-1.5 font-mono text-[11px] leading-4 text-[color:var(--app-fg)] outline-none focus:border-[color:var(--app-accent)]"
          value={inputText}
          disabled={disabled}
          spellCheck={false}
          aria-label={t("research.workbench.stepInput")}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      )}
    </div>
  );
}
