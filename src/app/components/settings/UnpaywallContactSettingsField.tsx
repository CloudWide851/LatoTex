import { Input } from "../../../components/ui/input";
import { InfoHint } from "../../../components/ui/info-hint";

type TranslationFn = (key: any) => string;

export function isValidUnpaywallContactEmail(raw: string): boolean {
  const value = raw.trim();
  if (!value) {
    return true;
  }
  if (Array.from(value).length > 254 || /\s/.test(value)) {
    return false;
  }
  const parts = value.split("@");
  return parts.length === 2
    && parts[0].length > 0
    && parts[1].includes(".");
}

export function UnpaywallContactSettingsField(props: {
  value: string;
  onChange: (value: string) => void;
  t: TranslationFn;
}) {
  const { value, onChange, t } = props;
  const invalid = !isValidUnpaywallContactEmail(value);
  const descriptionId = "settings-unpaywall-contact-description";

  return (
    <section className="app-material-inset grid gap-2 rounded-lg border p-3">
      <div className="flex items-center gap-1">
        <label
          className="text-xs font-semibold text-slate-700"
          htmlFor="settings-unpaywall-contact-email"
        >
          {t("settings.unpaywallContactEmail")}
        </label>
        {!invalid ? <InfoHint content={t("settings.unpaywallContactEmailHint")} label={t("settings.unpaywallContactEmail")} /> : null}
      </div>
      <Input
        id="settings-unpaywall-contact-email"
        type="email"
        inputMode="email"
        autoComplete="email"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        onBlur={(event) => {
          const normalized = event.currentTarget.value.trim();
          if (normalized !== value) {
            onChange(normalized);
          }
        }}
        placeholder={t("settings.unpaywallContactEmailPlaceholder")}
        aria-invalid={invalid}
        aria-describedby={descriptionId}
        className="h-9 text-xs"
      />
      <p
        id={descriptionId}
        className={invalid ? "text-xs text-rose-600" : "sr-only"}
        role={invalid ? "alert" : undefined}
      >
        {t(invalid
          ? "settings.unpaywallContactEmailInvalid"
          : "settings.unpaywallContactEmailHint")}
      </p>
    </section>
  );
}
