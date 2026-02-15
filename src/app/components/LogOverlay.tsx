import { X } from "lucide-react";

export function LogOverlay(props: { title: string; lines: string[]; onClose: () => void }) {
  const { title, lines, onClose } = props;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 motion-fade-in">
      <div className="grid h-[70vh] w-full max-w-3xl grid-rows-[48px_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-300 bg-white shadow-soft motion-slide-up">
        <div className="flex items-center justify-between border-b border-slate-200 px-4">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <button
            className="flex h-8 w-8 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-auto px-4 py-3">
          {lines.length === 0 ? (
            <p className="text-sm text-slate-500">-</p>
          ) : (
            <ul className="space-y-2 text-xs text-slate-700">
              {lines.map((line, index) => (
                <li
                  key={`${line}-${index}`}
                  className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  {line}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
