import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Trash2, Underline } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
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
const TEXT_COLORS = ["#0f172a", "#1d4ed8", "#16a34a", "#c2410c", "#be185d", "#475569"];

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
  onApplyInlineStyle?: (next: Partial<TextBoxStyle>) => boolean;
  onChangeStyle: (next: Partial<TextBoxStyle>) => void;
  onDelete: () => void;
  onClose: () => void;
  t: (key: any) => string;
}) {
  const { x, y, positioning = "fixed", style, onApplyInlineStyle, onChangeStyle, onDelete, onClose, t } = props;

  const preserveEditorSelection = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const applyTextStyle = (next: Partial<TextBoxStyle>) => {
    if (onApplyInlineStyle?.(next)) {
      return;
    }
    onChangeStyle(next);
  };

  return (
    <div
      data-textbox-menu="true"
      className={`${positioning === "fixed" ? "fixed" : "absolute"} z-[90] w-72 rounded-lg border border-slate-300 bg-white p-2 shadow-xl`}
      style={{ left: x, top: y }}
      onMouseDown={preserveEditorSelection}
    >
      <div className="mb-2 text-xs font-semibold text-slate-700">{t("library.viewer.textbox.menu.title")}</div>
      <div className="mb-2 grid grid-cols-[1fr_92px] gap-2">
        <Select
          uiSize="sm"
          value={style.fontFamily}
          onChange={(event) => applyTextStyle({ fontFamily: event.target.value })}
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
          onChange={(event) => applyTextStyle({ fontSize: Number(event.target.value) })}
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
          onMouseDown={preserveEditorSelection}
          onClick={() => applyTextStyle({ fontWeight: style.fontWeight === "bold" ? "normal" : "bold" })}
        >
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button
          className={`inline-flex h-8 w-8 items-center justify-center rounded border ${
            style.fontStyle === "italic" ? "border-primary-500 bg-primary-50 text-primary-700" : "border-slate-300 text-slate-700"
          }`}
          title={t("library.viewer.textbox.menu.italic")}
          onMouseDown={preserveEditorSelection}
          onClick={() => applyTextStyle({ fontStyle: style.fontStyle === "italic" ? "normal" : "italic" })}
        >
          <Italic className="h-3.5 w-3.5" />
        </button>
        <button
          className={`inline-flex h-8 w-8 items-center justify-center rounded border ${
            style.textDecoration === "underline" ? "border-primary-500 bg-primary-50 text-primary-700" : "border-slate-300 text-slate-700"
          }`}
          title={t("library.viewer.textbox.menu.underline")}
          onMouseDown={preserveEditorSelection}
          onClick={() =>
            applyTextStyle({ textDecoration: style.textDecoration === "underline" ? "none" : "underline" })
          }
        >
          <Underline className="h-3.5 w-3.5" />
        </button>
        <button
          className={`inline-flex h-8 w-8 items-center justify-center rounded border ${
            style.textAlign === "left" ? "border-primary-500 bg-primary-50 text-primary-700" : "border-slate-300 text-slate-700"
          }`}
          title={t("library.viewer.textbox.menu.alignLeft")}
          onMouseDown={preserveEditorSelection}
          onClick={() => onChangeStyle({ textAlign: "left" })}
        >
          <AlignLeft className="h-3.5 w-3.5" />
        </button>
        <button
          className={`inline-flex h-8 w-8 items-center justify-center rounded border ${
            style.textAlign === "center" ? "border-primary-500 bg-primary-50 text-primary-700" : "border-slate-300 text-slate-700"
          }`}
          title={t("library.viewer.textbox.menu.alignCenter")}
          onMouseDown={preserveEditorSelection}
          onClick={() => onChangeStyle({ textAlign: "center" })}
        >
          <AlignCenter className="h-3.5 w-3.5" />
        </button>
        <button
          className={`inline-flex h-8 w-8 items-center justify-center rounded border ${
            style.textAlign === "right" ? "border-primary-500 bg-primary-50 text-primary-700" : "border-slate-300 text-slate-700"
          }`}
          title={t("library.viewer.textbox.menu.alignRight")}
          onMouseDown={preserveEditorSelection}
          onClick={() => onChangeStyle({ textAlign: "right" })}
        >
          <AlignRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mb-2 flex items-center gap-1">
        {TEXT_COLORS.map((color) => (
          <button
            key={color}
            className="h-6 w-6 rounded-full border border-slate-300"
            style={{ backgroundColor: color }}
            title={t("library.viewer.textbox.menu.textColor")}
            onMouseDown={preserveEditorSelection}
            onClick={() => applyTextStyle({ textColor: color })}
          />
        ))}
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
}
