import type { KeyboardEvent } from "react";

type TranslationFn = (key: any) => string;

export function SleepWakeScreen(props: {
  logoMark: string;
  t: TranslationFn;
  onWake: () => void;
}) {
  const { logoMark, t, onWake } = props;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      return;
    }
    onWake();
  };

  return (
    <div
      className="relative flex h-screen w-screen cursor-pointer select-none items-center justify-center overflow-hidden bg-slate-950 text-slate-100"
      role="button"
      tabIndex={0}
      aria-label={t("app.sleep.wake")}
      onPointerDown={onWake}
      onKeyDown={handleKeyDown}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_22%,rgba(59,130,246,0.26),transparent_42%),radial-gradient(circle_at_82%_78%,rgba(16,185,129,0.2),transparent_44%),linear-gradient(135deg,#020617_0%,#0f172a_100%)]" />
      <section className="relative z-10 flex w-[min(92vw,560px)] flex-col items-center gap-5 rounded-2xl border border-white/15 bg-slate-900/72 px-8 py-10 text-center shadow-[0_18px_72px_rgba(2,6,23,0.55)] backdrop-blur-md">
        <img src={logoMark} alt={t("app.brand")} className="h-14 w-14 object-contain" draggable={false} />
        <h1 className="text-2xl font-semibold tracking-tight">{t("app.sleep.title")}</h1>
        <p className="text-sm text-slate-300">{t("app.sleep.hint")}</p>
      </section>
    </div>
  );
}
