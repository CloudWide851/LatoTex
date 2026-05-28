import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  FileText,
  Heading1,
  Heading2,
  Highlighter,
  Image,
  Italic,
  Link,
  List,
  ListOrdered,
  Paintbrush,
  Redo2,
  Replace,
  Search,
  Strikethrough,
  Subscript,
  Superscript,
  Table2,
  Underline,
  Undo2,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import type { TranslationFn } from "./docxUtils";

export type RibbonTab = "file" | "text" | "paragraph" | "insert" | "find";

type MarkState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeThrough: boolean;
  subscript: boolean;
  superscript: boolean;
};

export function DocxRibbonPopup(props: {
  activeTab: RibbonTab;
  disabled: boolean;
  activeMarks: MarkState;
  fontFamily: string;
  fontSize: string;
  fontColor: string;
  highlightColor: string;
  findText: string;
  replaceText: string;
  imageDisabled: boolean;
  onFontFamilyChange: (value: string) => void;
  onFontSizeChange: (value: string) => void;
  onFontColorChange: (value: string) => void;
  onHighlightColorChange: (value: string) => void;
  onFindTextChange: (value: string) => void;
  onReplaceTextChange: (value: string) => void;
  onFormat: (command: string, value?: string) => void;
  onInsertLink: () => void;
  onInsertTable: () => void;
  onInsertPageBreak: () => void;
  onInsertImage: () => void;
  onFindNext: () => void;
  onReplaceAll: () => void;
  t: TranslationFn;
}) {
  const {
    activeTab,
    disabled,
    activeMarks,
    fontFamily,
    fontSize,
    fontColor,
    highlightColor,
    findText,
    replaceText,
    imageDisabled,
    onFontFamilyChange,
    onFontSizeChange,
    onFontColorChange,
    onHighlightColorChange,
    onFindTextChange,
    onReplaceTextChange,
    onFormat,
    onInsertLink,
    onInsertTable,
    onInsertPageBreak,
    onInsertImage,
    onFindNext,
    onReplaceAll,
    t,
  } = props;

  const iconButton = (key: keyof MarkState | string, Icon: any, label: string, command: string, active = false) => (
    <Button
      key={key}
      size="icon"
      variant={active ? "secondary" : "ghost"}
      className="h-8 w-8"
      title={label}
      aria-label={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onFormat(command)}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );

  return (
    <div className="docx-ribbon-popover settings-scrollbar-hidden max-w-[min(760px,calc(100vw-120px))] overflow-auto rounded-md border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-widget-bg)] p-2 shadow-[var(--editor-widget-shadow)]">
      {activeTab === "file" ? (
        <div className="docx-ribbon-group">
          <span>{t("docx.ribbon.file")}</span>
          <div className="flex gap-1">
            {iconButton("undo", Undo2, t("docx.format.undo"), "undo")}
            {iconButton("redo", Redo2, t("docx.format.redo"), "redo")}
          </div>
        </div>
      ) : null}
      {activeTab === "text" ? (
        <div className="flex flex-wrap gap-2">
          <div className="docx-ribbon-group">
            <span>{t("docx.ribbon.style")}</span>
            <select className="h-8 rounded border border-slate-200 bg-white px-2 text-xs" disabled={disabled} defaultValue="p" onChange={(event) => onFormat("formatBlock", event.target.value)}>
              <option value="p">{t("docx.format.paragraph")}</option>
              <option value="h1">{t("docx.format.h1")}</option>
              <option value="h2">{t("docx.format.h2")}</option>
              <option value="h3">{t("docx.format.h3")}</option>
            </select>
          </div>
          <div className="docx-ribbon-group">
            <span>{t("docx.ribbon.font")}</span>
            <div className="flex flex-wrap gap-1">
              <select className="h-8 max-w-32 rounded border border-slate-200 bg-white px-2 text-xs" disabled={disabled} value={fontFamily} onChange={(event) => onFontFamilyChange(event.target.value)}>
                <option value="Microsoft YaHei">{t("docx.font.sans")}</option>
                <option value="SimSun">{t("docx.font.serif")}</option>
                <option value="Consolas">{t("docx.font.mono")}</option>
              </select>
              <select className="h-8 w-16 rounded border border-slate-200 bg-white px-2 text-xs" disabled={disabled} value={fontSize} onChange={(event) => onFontSizeChange(event.target.value)}>
                <option value="2">10</option>
                <option value="3">12</option>
                <option value="4">14</option>
                <option value="5">18</option>
                <option value="6">24</option>
              </select>
              {iconButton("bold", Bold, t("docx.format.bold"), "bold", activeMarks.bold)}
              {iconButton("italic", Italic, t("docx.format.italic"), "italic", activeMarks.italic)}
              {iconButton("underline", Underline, t("docx.format.underline"), "underline", activeMarks.underline)}
              {iconButton("strike", Strikethrough, t("docx.format.strike"), "strikeThrough", activeMarks.strikeThrough)}
              {iconButton("sub", Subscript, t("docx.format.subscript"), "subscript", activeMarks.subscript)}
              {iconButton("sup", Superscript, t("docx.format.superscript"), "superscript", activeMarks.superscript)}
              {iconButton("clear", Eraser, t("docx.format.clear"), "removeFormat")}
              <label className="relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600" title={t("docx.format.color")}>
                <Paintbrush className="h-4 w-4" />
                <input className="absolute inset-0 opacity-0" type="color" value={fontColor} disabled={disabled} onChange={(event) => onFontColorChange(event.target.value)} />
              </label>
              <label className="relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600" title={t("docx.format.highlight")}>
                <Highlighter className="h-4 w-4" />
                <input className="absolute inset-0 opacity-0" type="color" value={highlightColor} disabled={disabled} onChange={(event) => onHighlightColorChange(event.target.value)} />
              </label>
            </div>
          </div>
        </div>
      ) : null}
      {activeTab === "paragraph" ? (
        <div className="docx-ribbon-group">
          <span>{t("docx.ribbon.paragraph")}</span>
          <div className="flex flex-wrap gap-1">
            {iconButton("left", AlignLeft, t("docx.format.alignLeft"), "justifyLeft")}
            {iconButton("center", AlignCenter, t("docx.format.alignCenter"), "justifyCenter")}
            {iconButton("right", AlignRight, t("docx.format.alignRight"), "justifyRight")}
            {iconButton("bullet", List, t("docx.format.bullet"), "insertUnorderedList")}
            {iconButton("numbered", ListOrdered, t("docx.format.numbered"), "insertOrderedList")}
            {iconButton("outdent", Undo2, t("docx.format.outdent"), "outdent")}
            {iconButton("indent", Redo2, t("docx.format.indent"), "indent")}
          </div>
        </div>
      ) : null}
      {activeTab === "insert" ? (
        <div className="docx-ribbon-group">
          <span>{t("docx.ribbon.insert")}</span>
          <div className="flex flex-wrap gap-1">
            <Button size="icon" variant="ghost" className="h-8 w-8" title={t("docx.format.h1")} aria-label={t("docx.format.h1")} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => onFormat("formatBlock", "h1")}><Heading1 className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" title={t("docx.format.h2")} aria-label={t("docx.format.h2")} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => onFormat("formatBlock", "h2")}><Heading2 className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" title={t("docx.format.link")} aria-label={t("docx.format.link")} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onInsertLink}><Link className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" title={t("docx.format.table")} aria-label={t("docx.format.table")} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onInsertTable}><Table2 className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" title={t("docx.format.pageBreak")} aria-label={t("docx.format.pageBreak")} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onInsertPageBreak}><FileText className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" title={t("docx.format.image")} aria-label={t("docx.format.image")} disabled={disabled || imageDisabled} onMouseDown={(event) => event.preventDefault()} onClick={onInsertImage}><Image className="h-4 w-4" /></Button>
          </div>
        </div>
      ) : null}
      {activeTab === "find" ? (
        <div className="docx-ribbon-group min-w-[330px]">
          <span>{t("docx.ribbon.find")}</span>
          <div className="grid grid-cols-[minmax(90px,1fr)_minmax(90px,1fr)_auto_auto] gap-1">
            <Input className="h-8 text-xs" value={findText} onChange={(event) => onFindTextChange(event.target.value)} placeholder={t("docx.find")} />
            <Input className="h-8 text-xs" value={replaceText} onChange={(event) => onReplaceTextChange(event.target.value)} placeholder={t("docx.replace")} />
            <Button size="icon" variant="secondary" className="h-8 w-8" disabled={!findText || disabled} onClick={onFindNext} title={t("docx.findNext")} aria-label={t("docx.findNext")}><Search className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="secondary" className="h-8 w-8" disabled={!findText || disabled} onClick={onReplaceAll} title={t("docx.replaceAll")} aria-label={t("docx.replaceAll")}><Replace className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
