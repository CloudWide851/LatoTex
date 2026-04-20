declare module "/assets/share_page_i18n.js" {
  export function createI18n(locale: string): Record<string, unknown>;
  export function detectDevice(): "desktop" | "mobile";
  export function detectLocale(preferred?: string | null): string;
}

declare module "/assets/share_page_app.js" {
  export function bootstrapSharePage(options?: {
    device?: "desktop" | "mobile";
    locale?: string;
    i18n?: Record<string, unknown>;
  }): Promise<void>;
}
