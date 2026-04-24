import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Trash2, Underline } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { Select } from "../../../components/ui/select";

const FONT_FAMILIES = [
  "Segoe UI",
  "Times New Roman",
  "Arial",
  "Consolas",
  "Noto Sans SC",
  "Microsoft YaHei",
];

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32];
const TEXTBOX_COLOR_PALETTE = [
  "#0f172a", "#1e293b", "#334155", "#475569", "#64748b",
  "#111827", "#1d4ed8", "#2563eb", "#0f766e", "#059669",
  "#16a34a", "#65a30d", "#ca8a04", "#ea580c", "#dc2626",
  "#be123c", "#c026d3", "#7c3aed", "#4f46e5", "#0891b2",
];

type TextBoxStyle = {
  fontSize: number;
  textColor: string;
  fontFamily: string;
  textAlign: "left" | "center" | "right";
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  textDecoration: "none" | "underline";
};

export function PdfTextBoxContextMenu(props: {
  x: number;
  y: number;
  positioning?: "fixed" | "absolute";
  style: TextBoxStyle;
  onApplyStyle: (next: Partial<TextBoxStyle>, options?: { preferInline?: boolean }) => void;
  onDelete: () => void;
  onClose: () => void;
  t: (key: any) => string;
}) {
  const { x, y, positioning = "fixed", style, onApplyStyle, onDelete, onClose, t } = props;

  const preserveEditorSelection = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const keepMenuOpen = (event: ReactMouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  const applyTextStyle = (
    event: ReactMouseEvent<HTMLElement>,
    next: Partial<TextBoxStyle>,
    options?: { preferInline?: boolean },
  ) => {
    preserveEditorSelection(event);
    onApplyStyle(next, options);
  };

  const commitHexColor = (raw: string) => {
    const normalized = raw.trim();
    if (!/^#[0-9a-f]{6}$/i.test(normalized)) {
      return;
    }
    onApplyStyle({ textColor: normalized });
  };

  const menu = (
    <div
      data-textbox-menu="true"
      className={`${positioning === "fixed" ? "fixed" : "absolute"} z-[620] w-80 rounded-lg border border-slate-300 bg-white p-3 shadow-xl`}
      style={{ left: x, top: y }}
      onMouseDown={keepMenuOpen}
    >
      <div className="mb-2 text-xs font-semibold text-slate-700">{t("library.viewer.textbox.menu.title")}</div>
      <div className="mb-3 grid grid-cols-[minmax(0,1fr)_104px] gap-2">
        <Select
          uiSize="sm"
          value={style.fontFamily}
          restoreFocusOnCommit={false}
          onChange={(event) => onApplyStyle({ fontFamily: event.target.value })}
          portalClassName="z-[780]"
          portalAttributes={{
            "data-textbox-menu": "true",
            onMouseDown: preserveEditorSelection,
          }}
        >
          {FONT_FAMILIES.map((family) => (
            <option key={family} value={family}>{family}</option>
          ))}
        </Select>
        <Select
          uiSize="sm"
          value={String(style.fontSize)}
          restoreFocusOnCommit={false}
          onChange={(event) => onApplyStyle({ fontSize: Number(event.target.value) })}
          portalClassName="z-[780]"
          portalAttributes={{
            "data-textbox-menu": "true",
            onMouseDown: preserveEditorSelection,
          }}
        >
          {FONT_SIZES.map((size) => (
            <option key={size} value={size}>{size}</option>
          ))}
        </Select>
      </div>

      <div className="mb-2 flex items-center gap-1">
        <button
          className={`inline-flex h-8 w-8 items-center justify-center rounded border ${
            style.fontWeight === "bold" ? "border-primary-500 bg-primary-50 text-primary-700" : "border-slate-300 text-slate-700"
          }`}
          title={t("library.viewer.textbox.menu.bold")}
          onMouseDown={(event) => applyTextStyle(event, { fontWeight: style.fontWeight === "bold" ? "normal" : "bold" })}
        >
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button
          className={`inline-flex h-8 w-8 items-center justify-center rounded border ${
            style.fontStyle === "italic" ? "border-primary-500 bg-primary-50 text-primary-700" : "border-slate-300 text-slate-700"
          }`}
          title={t("library.viewer.textbox.menu.italic")}
          onMouseDown={(event) => applyTextStyle(event, { fontStyle: style.fontStyle === "italic" ? "normal" : "italic" })}
        >
          <Italic className="h-3.5 w-3.5" />
        </button>
        <button
          className={`inline-flex h-8 w-8 items-center justify-center rounded border ${
            style.textDecoration === "underline" ? "border-primary-500 bg-primary-50 text-primary-700" : "border-slate-300 text-slate-700"
          }`}
          title={t("library.viewer.textbox.menu.underline")}
          onMouseDown={(event) => applyTextStyle(
            event,
            { textDecoration: style.textDecoration === "underline" ? "none" : "underline" },
          )}
        >
          <Underline className="h-3.5 w-3.5" />
        </button>
        <button
          className={`inline-flex h-8 w-8 items-center justify-center rounded border ${
            style.textAlign === "left" ? "border-primary-500 bg-primary-50 text-primary-700" : "border-slate-300 text-slate-700"
          }`}
          title={t("library.viewer.textbox.menu.alignLeft")}
          onMouseDown={(event) => applyTextStyle(event, { textAlign: "left" }, { preferInline: false })}
        >
          <AlignLeft className="h-3.5 w-3.5" />
        </button>
        <button
          className={`inline-flex h-8 w-8 items-center justify-center rounded border ${
            style.textAlign === "center" ? "border-primary-500 bg-primary-50 text-primary-700" : "border-slate-300 text-slate-700"
          }`}
          title={t("library.viewer.textbox.menu.alignCenter")}
          onMouseDown={(event) => applyTextStyle(event, { textAlign: "center" }, { preferInline: false })}
        >
          <AlignCenter className="h-3.5 w-3.5" />
        </button>
        <button
          className={`inline-flex h-8 w-8 items-center justify-center rounded border ${
            style.textAlign === "right" ? "border-primary-500 bg-primary-50 text-primary-700" : "border-slate-300 text-slate-700"
          }`}
          title={t("library.viewer.textbox.menu.alignRight")}
          onMouseDown={(event) => applyTextStyle(event, { textAlign: "right" }, { preferInline: false })}
        >
          <AlignRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mb-3">
        <div className="mb-1 text-[11px] font-medium text-slate-500">{t("library.viewer.textbox.menu.textColor")}</div>
        <div className="mb-2 grid grid-cols-5 gap-1.5">
          {TEXTBOX_COLOR_PALETTE.map((color) => (
            <button
              key={color}
              className={`h-7 w-full rounded border ${style.textColor.toLowerCase() === color.toLowerCase() ? "border-slate-700 ring-1 ring-slate-400" : "border-slate-300"}`}
              style={{ backgroundColor: color }}
              title={color}
              onMouseDown={(event) => applyTextStyle(event, { textColor: color })}
            />
          ))}
        </div>
        <div className="grid grid-cols-[1fr_44px] gap-2">
          <input
            value={style.textColor}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-primary-500"
            onMouseDown={(event) => event.stopPropagation()}
            onBlur={(event) => commitHexColor(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitHexColor((event.currentTarget as HTMLInputElement).value);
              }
            }}
          />
          <input
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(style.textColor) ? style.textColor : "#1f2937"}
            className="h-9 w-full cursor-pointer rounded border border-slate-300 bg-white p-1"
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => commitHexColor(event.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 pt-2">
        <button
          className="inline-flex items-center gap-1 rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-700"
          onMouseDown={preserveEditorSelection}
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t("library.viewer.textboxDelete")}
        </button>
        <button
          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
          onMouseDown={preserveEditorSelection}
          onClick={onClose}
        >
          {t("common.close")}
        </button>
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return menu;
  }

  return createPortal(menu, document.body);
}
