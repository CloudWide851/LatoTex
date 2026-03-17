import { ChevronDown, Link2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "../../lib/utils";
import zoteroIcon from "../../assets/brands/zotero.svg";
import {
  dropdownItemClassName,
  dropdownSurfaceClassName,
  useDropdownDismiss,
} from "../../components/ui/dropdown";

type TranslationFn = (key: any) => string;

export function LibraryUploadMenu(props: {
  busy: boolean;
  onImportPdf: () => void;
  onImportLink: (link: string) => void;
  onSyncZotero: (input: { ownerId: string; apiKey: string; scope?: "users" | "groups" }) => void;
  t: TranslationFn;
}) {
  const { busy, onImportPdf, onImportLink, onSyncZotero, t } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkKind, setLinkKind] = useState<"link" | "zotero" | "zotero-sync">("link");
  const [linkDraft, setLinkDraft] = useState("");
  const [zoteroOwnerId, setZoteroOwnerId] = useState("");
  const [zoteroApiKey, setZoteroApiKey] = useState("");
  const [zoteroScope, setZoteroScope] = useState<"users" | "groups">("users");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useDropdownDismiss({
    open: menuOpen || linkOpen,
    rootRef,
    onClose: () => {
      setMenuOpen(false);
      setLinkOpen(false);
    },
  });

  return (
    <div ref={rootRef} className="relative">
      <button
        className="inline-flex h-8 items-center gap-1 rounded border border-slate-300 bg-white px-2 text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
        onClick={() => setMenuOpen((prev) => !prev)}
        disabled={busy}
        title={t("library.upload")}
        aria-label={t("library.upload")}
      >
        <Upload className="h-4 w-4" />
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {menuOpen && (
        <div className={dropdownSurfaceClassName("absolute right-0 mt-1 min-w-40 py-1.5 px-1.5")}>
          <button
            className={dropdownItemClassName()}
            onClick={() => {
              setMenuOpen(false);
              onImportPdf();
            }}
          >
            <Upload className="h-3.5 w-3.5" />
            <span>{t("library.uploadPdf")}</span>
          </button>
          <button
            className={dropdownItemClassName()}
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
            className={dropdownItemClassName()}
            onClick={() => {
              setLinkKind("zotero");
              setLinkOpen(true);
              setMenuOpen(false);
            }}
          >
            <img src={zoteroIcon} alt="" className="h-3.5 w-3.5 rounded-sm" />
            <span>{t("library.importZotero")}</span>
          </button>
          <button
            className={dropdownItemClassName()}
            onClick={() => {
              setLinkKind("zotero-sync");
              setLinkOpen(true);
              setMenuOpen(false);
            }}
          >
            <img src={zoteroIcon} alt="" className="h-3.5 w-3.5 rounded-sm" />
            <span>{t("library.syncZoteroFull")}</span>
          </button>
        </div>
      )}

      {linkOpen && (
        <div className={dropdownSurfaceClassName("absolute right-0 mt-1 w-72 p-2") }>
          {linkKind === "zotero-sync" ? (
            <div className="space-y-2">
              <select
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-primary-500"
                value={zoteroScope}
                onChange={(event) => setZoteroScope(event.target.value as "users" | "groups")}
              >
                <option value="users">{t("library.zoteroScopeUsers")}</option>
                <option value="groups">{t("library.zoteroScopeGroups")}</option>
              </select>
              <input
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-primary-500"
                value={zoteroOwnerId}
                placeholder={t("library.zoteroOwnerIdPlaceholder")}
                onChange={(event) => setZoteroOwnerId(event.target.value)}
              />
              <input
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-primary-500"
                type="password"
                value={zoteroApiKey}
                placeholder={t("library.zoteroTokenPlaceholder")}
                onChange={(event) => setZoteroApiKey(event.target.value)}
              />
            </div>
          ) : (
            <input
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-primary-500"
              value={linkDraft}
              placeholder={linkKind === "zotero" ? t("library.zoteroPlaceholder") : t("library.linkPlaceholder")}
              onChange={(event) => setLinkDraft(event.target.value)}
            />
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
              onClick={() => {
                setLinkDraft("");
                setZoteroOwnerId("");
                setZoteroApiKey("");
                setLinkOpen(false);
              }}
            >
              {t("common.cancel")}
            </button>
            <button
              className={cn(
                "rounded border px-2 py-1 text-xs text-white",
                (linkKind === "zotero-sync"
                  ? zoteroOwnerId.trim() && zoteroApiKey.trim()
                  : linkDraft.trim())
                  ? "border-primary-600 bg-primary-600 hover:bg-primary-500"
                  : "cursor-not-allowed border-primary-300 bg-primary-300",
              )}
              disabled={(
                linkKind === "zotero-sync"
                  ? !zoteroOwnerId.trim() || !zoteroApiKey.trim()
                  : !linkDraft.trim()
              ) || busy}
              onClick={() => {
                if (linkKind === "zotero-sync") {
                  onSyncZotero({
                    ownerId: zoteroOwnerId.trim(),
                    apiKey: zoteroApiKey.trim(),
                    scope: zoteroScope,
                  });
                  setZoteroOwnerId("");
                  setZoteroApiKey("");
                  setLinkOpen(false);
                  return;
                }
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
