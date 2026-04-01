import { ChevronDown, Link2, Upload } from "lucide-react";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from "react";
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
type FloatingPanelKind = "menu" | "link";

function buildFloatingPanelStyle(trigger: HTMLButtonElement, kind: FloatingPanelKind): CSSProperties {
  if (typeof window === "undefined") {
    return {};
  }
  const rect = trigger.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.max(
    kind === "link" ? Math.min(288, viewportWidth - 24) : Math.max(176, rect.width),
    156,
  );
  const maxLeft = Math.max(12, viewportWidth - width - 12);
  const left = Math.min(Math.max(12, rect.right - width), maxLeft);
  const top = Math.min(rect.bottom + 8, viewportHeight - 72);
  return {
    position: "fixed",
    left,
    top,
    width,
    maxHeight: Math.max(160, viewportHeight - top - 16),
  };
}

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
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const linkPanelRef = useRef<HTMLDivElement | null>(null);

  useDropdownDismiss({
    open: menuOpen || linkOpen,
    rootRef,
    includeRefs: [menuPanelRef, linkPanelRef],
    onClose: () => {
      setMenuOpen(false);
      setLinkOpen(false);
    },
  });

  const updatePanelPosition = useCallback((kind: FloatingPanelKind) => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    setPanelStyle(buildFloatingPanelStyle(trigger, kind));
  }, []);

  useEffect(() => {
    const kind: FloatingPanelKind | null = linkOpen ? "link" : (menuOpen ? "menu" : null);
    if (!kind) {
      return;
    }
    updatePanelPosition(kind);
    const handleReposition = () => updatePanelPosition(kind);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [linkOpen, menuOpen, updatePanelPosition]);

  const canConfirm = linkKind === "zotero-sync"
    ? Boolean(zoteroOwnerId.trim() && zoteroApiKey.trim())
    : Boolean(linkDraft.trim());

  const renderFloatingPanel = useCallback((
    content: ReactNode,
    panelRef: MutableRefObject<HTMLDivElement | null>,
  ) => {
    const panel = (
      <div ref={panelRef} className={dropdownSurfaceClassName("fixed z-[520] overflow-auto")} style={panelStyle}>
        {content}
      </div>
    );
    if (typeof document === "undefined") {
      return panel;
    }
    return createPortal(panel, document.body);
  }, [panelStyle]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        className={dropdownTriggerClassName("h-8 gap-1.5 px-2.5 text-xs")}
        onClick={() => {
          const next = !menuOpen;
          setLinkOpen(false);
          setMenuOpen(next);
          if (next) {
            updatePanelPosition("menu");
          }
        }}
        disabled={busy}
        title={t("library.upload")}
        aria-label={t("library.upload")}
      >
        <Upload className="h-4 w-4" />
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {menuOpen && renderFloatingPanel(
        <div className="min-w-44 py-1.5">
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
              setMenuOpen(false);
              setLinkOpen(true);
              updatePanelPosition("link");
            }}
          >
            <Link2 className="h-3.5 w-3.5" />
            <span>{t("library.addLink")}</span>
          </button>
          <button
            className={dropdownItemClassName()}
            onClick={() => {
              setLinkKind("zotero");
              setMenuOpen(false);
              setLinkOpen(true);
              updatePanelPosition("link");
            }}
          >
            <img src={zoteroIcon} alt="" className="h-3.5 w-3.5 rounded-sm" />
            <span>{t("library.importZotero")}</span>
          </button>
          <button
            className={dropdownItemClassName()}
            onClick={() => {
              setLinkKind("zotero-sync");
              setMenuOpen(false);
              setLinkOpen(true);
              updatePanelPosition("link");
            }}
          >
            <img src={zoteroIcon} alt="" className="h-3.5 w-3.5 rounded-sm" />
            <span>{t("library.syncZoteroFull")}</span>
          </button>
        </div>,
        menuPanelRef,
      )}

      {linkOpen && renderFloatingPanel(
        <div className="w-full p-2.5">
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
        </div>,
        linkPanelRef,
      )}
    </div>
  );
}
