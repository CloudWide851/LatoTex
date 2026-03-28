import { ChevronDown, Link2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import zoteroIcon from "../../assets/brands/zotero.svg";
import { Button } from "../../components/ui/button";
import {
  dropdownItemClassName,
  dropdownSearchInputClassName,
  dropdownSurfaceClassName,
  dropdownTriggerClassName,
  useDropdownDismiss,
} from "../../components/ui/dropdown";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";

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

  const canConfirm = linkKind === "zotero-sync"
    ? Boolean(zoteroOwnerId.trim() && zoteroApiKey.trim())
    : Boolean(linkDraft.trim());

  return (
    <div ref={rootRef} className="relative">
      <button
        className={dropdownTriggerClassName("h-8 gap-1.5 px-2.5 text-xs")}
        onClick={() => setMenuOpen((prev) => !prev)}
        disabled={busy}
        title={t("library.upload")}
        aria-label={t("library.upload")}
      >
        <Upload className="h-4 w-4" />
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {menuOpen && (
        <div className={dropdownSurfaceClassName("absolute right-0 mt-1 min-w-44 py-1.5")}>
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
        <div className={dropdownSurfaceClassName("absolute right-0 mt-1 w-72 p-2.5")}>
          {linkKind === "zotero-sync" ? (
            <div className="space-y-2">
              <Select
                uiSize="sm"
                className="w-full"
                value={zoteroScope}
                onChange={(event) => setZoteroScope(event.target.value as "users" | "groups")}
              >
                <option value="users">{t("library.zoteroScopeUsers")}</option>
                <option value="groups">{t("library.zoteroScopeGroups")}</option>
              </Select>
              <Input
                className="h-8 text-xs"
                value={zoteroOwnerId}
                placeholder={t("library.zoteroOwnerIdPlaceholder")}
                onChange={(event) => setZoteroOwnerId(event.target.value)}
              />
              <Input
                className="h-8 text-xs"
                type="password"
                value={zoteroApiKey}
                placeholder={t("library.zoteroTokenPlaceholder")}
                onChange={(event) => setZoteroApiKey(event.target.value)}
              />
            </div>
          ) : (
            <input
              className={dropdownSearchInputClassName("control-surface h-8 px-2.5")}
              value={linkDraft}
              placeholder={linkKind === "zotero" ? t("library.zoteroPlaceholder") : t("library.linkPlaceholder")}
              onChange={(event) => setLinkDraft(event.target.value)}
            />
          )}
          <div className="mt-2.5 flex justify-end gap-2">
            <Button
              variant="surface"
              size="sm"
              onClick={() => {
                setLinkDraft("");
                setZoteroOwnerId("");
                setZoteroApiKey("");
                setLinkOpen(false);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant={canConfirm ? "default" : "surface"}
              size="sm"
              disabled={!canConfirm || busy}
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
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
