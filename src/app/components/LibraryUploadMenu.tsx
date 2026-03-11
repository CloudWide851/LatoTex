import { ChevronDown, Link2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import zoteroIcon from "../../assets/brands/zotero.svg";

type TranslationFn = (key: any) => string;

export function LibraryUploadMenu(props: {
  busy: boolean;
  onImportPdf: () => void;
  onImportLink: (link: string) => void;
  t: TranslationFn;
}) {
  const { busy, onImportPdf, onImportLink, t } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkKind, setLinkKind] = useState<"link" | "zotero">("link");
  const [linkDraft, setLinkDraft] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (rootRef.current && target && rootRef.current.contains(target)) {
        return;
      }
      setMenuOpen(false);
      setLinkOpen(false);
    };
    window.addEventListener("mousedown", onDocumentMouseDown);
    return () => {
      window.removeEventListener("mousedown", onDocumentMouseDown);
    };
  }, []);

  return (
    <div ref={rootRef} className="relative">
      <button
        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
        onClick={() => setMenuOpen((prev) => !prev)}
        disabled={busy}
        title={t("library.upload")}
        aria-label={t("library.upload")}
      >
        <Upload className="h-3.5 w-3.5" />
        <span>{t("library.upload")}</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {menuOpen && (
        <div className="absolute right-0 z-20 mt-1 min-w-36 overflow-hidden rounded-md border border-slate-300 bg-white py-1 shadow-lg">
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
            onClick={() => {
              setMenuOpen(false);
              onImportPdf();
            }}
          >
            <Upload className="h-3.5 w-3.5" />
            <span>{t("library.uploadPdf")}</span>
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
            onClick={() => {
              setLinkKind("link");
              setLinkOpen(true);
              setMenuOpen(false);
            }}
          >
            <Link2 className="h-3.5 w-3.5" />
            <span>{t("library.addLink")}</span>
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
            onClick={() => {
              setLinkKind("zotero");
              setLinkOpen(true);
              setMenuOpen(false);
            }}
          >
            <img src={zoteroIcon} alt="" className="h-3.5 w-3.5 rounded-sm" />
            <span>{t("library.importZotero")}</span>
          </button>
        </div>
      )}

      {linkOpen && (
        <div className="absolute right-0 z-30 mt-1 w-72 rounded-md border border-slate-300 bg-white p-2 shadow-lg">
          <input
            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-primary-500"
            value={linkDraft}
            placeholder={linkKind === "zotero" ? t("library.zoteroPlaceholder") : t("library.linkPlaceholder")}
            onChange={(event) => setLinkDraft(event.target.value)}
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
              onClick={() => {
                setLinkDraft("");
                setLinkOpen(false);
              }}
            >
              {t("common.cancel")}
            </button>
            <button
              className={cn(
                "rounded border px-2 py-1 text-xs text-white",
                linkDraft.trim()
                  ? "border-primary-600 bg-primary-600 hover:bg-primary-500"
                  : "cursor-not-allowed border-primary-300 bg-primary-300",
              )}
              disabled={!linkDraft.trim() || busy}
              onClick={() => {
                const normalized = linkDraft.trim();
                if (!normalized) {
                  return;
                }
                onImportLink(normalized);
                setLinkDraft("");
                setLinkOpen(false);
              }}
            >
              {t("common.confirm")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
