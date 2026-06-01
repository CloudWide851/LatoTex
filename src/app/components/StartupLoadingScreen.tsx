type TranslationFn = (key: any) => string;

export function StartupLoadingScreen(props: {
  logoMark: string;
  t: TranslationFn;
}) {
  const { logoMark, t } = props;
  return (
    <section className="startup-loading-screen flex h-full min-h-0 items-center justify-center bg-[color:var(--editor-paper-bg)] px-6 text-[color:var(--editor-tab-muted)]">
      <div className="startup-loading-card motion-card-pop">
        <div className="startup-loading-orbit" aria-hidden>
          <span />
          <span />
          <span />
          <img src={logoMark} alt="" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[color:var(--control-text)]">{t("common.loading")}</div>
          <div className="mt-1 text-xs text-[color:var(--control-muted)]">{t("app.startup.lightHint")}</div>
          <div className="startup-loading-track mt-3" aria-hidden>
            <span />
          </div>
        </div>
      </div>
    </section>
  );
}
