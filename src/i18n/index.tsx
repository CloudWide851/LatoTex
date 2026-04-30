import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { enUS, type MessageKey } from "./messages/en-US/index";
import { zhCN } from "./messages/zh-CN/index";

export type Locale = "en-US" | "zh-CN";

type I18nContextValue = {
  locale: Locale;
  t: (key: MessageKey) => string;
  setLocale: (locale: Locale) => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const MESSAGE_MAP: Record<Locale, Record<MessageKey, string>> = {
  "en-US": enUS,
  "zh-CN": zhCN
};

function normalizeLocale(input: string | null | undefined): Locale {
  if (!input) {
    return "en-US";
  }
  if (input.toLowerCase().startsWith("zh")) {
    return "zh-CN";
  }
  return "en-US";
}

export function detectSystemLocale(): Locale {
  return normalizeLocale(typeof navigator !== "undefined" ? navigator.language : null);
}

export function resolveLocale(preferred?: string | null): Locale {
  if (preferred === "en-US" || preferred === "zh-CN") {
    return preferred;
  }
  return detectSystemLocale();
}

export function I18nProvider(props: {
  initialLocale: Locale;
  children: React.ReactNode;
  onLocaleChange?: (locale: Locale) => void;
}) {
  const { initialLocale, children, onLocaleChange } = props;
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => {
    const messages = MESSAGE_MAP[locale];
    return {
      locale,
      t: (key) => messages[key] ?? key,
      setLocale: (nextLocale) => {
        setLocaleState(nextLocale);
        onLocaleChange?.(nextLocale);
      }
    };
  }, [locale, onLocaleChange]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return context;
}
