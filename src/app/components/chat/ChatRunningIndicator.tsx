export function ChatRunningIndicator(props: {
  label: string;
  inline?: boolean;
}) {
  const { label, inline = false } = props;
  const containerClass = inline
    ? "inline-flex items-center gap-2 text-slate-500"
    : "mt-2 inline-flex items-center gap-2 text-[11px] text-slate-500";
  return (
    <span className={containerClass}>
      <span>{label}</span>
      <span className="inline-flex items-end gap-1" aria-hidden="true">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.24s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.12s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
      </span>
      <span className="inline-block h-3 w-px animate-pulse bg-current/70 align-middle" aria-hidden="true" />
    </span>
  );
}