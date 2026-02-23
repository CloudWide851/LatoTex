import { Eye, EyeOff, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { SvgSpinner } from "../../components/ui/svg-spinner";
import type { ModelCatalogItem, ModelProtocol } from "../../shared/types/app";

type TranslationFn = (key: any) => string;

export function ModelModal(props: {
  open: boolean;
  mode?: "create" | "edit";
  initialModel?: ModelCatalogItem | null;
  protocols: ModelProtocol[];
  onClose: () => void;
  onGetModelApiKey: (modelId: string) => Promise<string>;
  onSubmit: (payload: {
    protocol: {
      id: string;
      displayName: string;
      baseUrl: string;
      apiKey?: string;
      isNew: boolean;
    };
    model: ModelCatalogItem;
    modelApiKey?: string;
    modelApiKeyChanged: boolean;
  }) => Promise<{ ok: boolean; message?: string }>;
  t: TranslationFn;
}) {
  const {
    open,
    mode: dialogMode = "create",
    initialModel,
    protocols,
    onClose,
    onGetModelApiKey,
    onSubmit,
    t,
  } = props;

  const [protocolMode, setProtocolMode] = useState<"existing" | "new">("existing");
  const [protocolId, setProtocolId] = useState(protocols[0]?.id ?? "openai-compatible");
  const [newProtocolId, setNewProtocolId] = useState("");
  const [newProtocolName, setNewProtocolName] = useState("");
  const [newProtocolBaseUrl, setNewProtocolBaseUrl] = useState("");
  const [existingProtocolBaseUrl, setExistingProtocolBaseUrl] = useState("");
  const [modelDisplayName, setModelDisplayName] = useState("");
  const [modelRequestName, setModelRequestName] = useState("");
  const [modelApiKey, setModelApiKey] = useState("");
  const [initialApiKey, setInitialApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [loadingApiKey, setLoadingApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  const selectedProtocol = useMemo(
    () => protocols.find((item) => item.id === protocolId),
    [protocolId, protocols],
  );

  const resolvedProtocol = protocolMode === "new"
    ? {
        id: newProtocolId.trim(),
        displayName: newProtocolName.trim(),
        baseUrl: newProtocolBaseUrl.trim(),
        apiKey: modelApiKey.trim(),
        isNew: true,
      }
    : {
        id: protocolId,
        displayName: selectedProtocol?.displayName ?? protocolId,
        baseUrl: existingProtocolBaseUrl.trim(),
        apiKey: modelApiKey.trim(),
        isNew: false,
      };

  const apiKeyChanged = modelApiKey !== initialApiKey;

  useEffect(() => {
    setExistingProtocolBaseUrl(selectedProtocol?.baseUrl ?? "");
  }, [selectedProtocol?.baseUrl, selectedProtocol?.id]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const nextProtocolId = initialModel?.protocolId ?? protocols[0]?.id ?? "openai-compatible";
    setProtocolMode("existing");
    setProtocolId(nextProtocolId);
    setNewProtocolId("");
    setNewProtocolName("");
    setNewProtocolBaseUrl("");
    const linked = protocols.find((item) => item.id === nextProtocolId);
    setExistingProtocolBaseUrl(linked?.baseUrl ?? "");
    setModelDisplayName(initialModel?.displayName ?? "");
    setModelRequestName(initialModel?.requestName ?? "");
    setModelApiKey("");
    setInitialApiKey("");
    setShowApiKey(false);
    setLoadingApiKey(false);
    setSaving(false);
    setSaveMessage("");
  }, [initialModel?.displayName, initialModel?.protocolId, initialModel?.requestName, open, protocols]);

  useEffect(() => {
    if (!open || dialogMode !== "edit" || !initialModel?.id) {
      return;
    }
    let active = true;
    setLoadingApiKey(true);
    onGetModelApiKey(initialModel.id)
      .then((key) => {
        if (!active) {
          return;
        }
        setInitialApiKey(key ?? "");
        setModelApiKey(key ?? "");
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setInitialApiKey("");
        setModelApiKey("");
      })
      .finally(() => {
        if (active) {
          setLoadingApiKey(false);
        }
      });
    return () => {
      active = false;
    };
  }, [dialogMode, initialModel?.id, onGetModelApiKey, open]);

  if (!open) {
    return null;
  }

  const canSubmitBase =
    resolvedProtocol.id.length > 0 &&
    resolvedProtocol.displayName.length > 0 &&
    resolvedProtocol.baseUrl.length > 0 &&
    modelDisplayName.trim().length > 0 &&
    modelRequestName.trim().length > 0;

  const handleSave = async () => {
    if (!canSubmitBase) {
      return;
    }

    setSaving(true);
    setSaveMessage("");
    const requestName = modelRequestName.trim();
    const modelId = dialogMode === "edit" && initialModel?.id
      ? initialModel.id
      : `${resolvedProtocol.id}-${requestName.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`;

    const response = await onSubmit({
      protocol: resolvedProtocol,
      model: {
        id: modelId,
        protocolId: resolvedProtocol.id,
        displayName: modelDisplayName.trim(),
        requestName,
      },
      modelApiKey: modelApiKey.trim(),
      modelApiKeyChanged: apiKeyChanged,
    });

    setSaving(false);
    if (!response.ok) {
      setSaveMessage(response.message || t("settings.modal.saveFailed"));
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 motion-fade-in">
      <div className="grid h-[min(84vh,780px)] w-full max-w-2xl grid-rows-[52px_minmax(0,1fr)_64px] overflow-hidden rounded-lg border border-slate-300 bg-white shadow-soft motion-slide-up">
        <div className="flex items-center justify-between border-b border-slate-200 px-4">
          <h3 className="text-sm font-semibold text-slate-800">
            {dialogMode === "edit" ? t("settings.modal.editTitle") : t("settings.modal.createTitle")}
          </h3>
          <button
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            onClick={onClose}
            title={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-auto p-4 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={protocolMode === "existing" ? "default" : "secondary"}
              onClick={() => setProtocolMode("existing")}
            >
              {t("settings.modal.useExistingProtocol")}
            </Button>
            <Button
              variant={protocolMode === "new" ? "default" : "secondary"}
              onClick={() => setProtocolMode("new")}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("settings.modal.createProtocol")}
            </Button>
          </div>

          {protocolMode === "existing" ? (
            <div className="grid gap-2">
              <label className="grid gap-1">
                <span className="text-xs text-slate-500">{t("settings.modal.protocol")}</span>
                <Select
                  value={protocolId}
                  onChange={(event) => {
                    setProtocolId(event.target.value);
                    setSaveMessage("");
                  }}
                >
                  {protocols.map((protocol) => (
                    <option key={protocol.id} value={protocol.id}>
                      {protocol.displayName}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-slate-500">{t("settings.baseUrl")}</span>
                <Input
                  value={existingProtocolBaseUrl}
                  onChange={(event) => {
                    setExistingProtocolBaseUrl(event.target.value);
                    setSaveMessage("");
                  }}
                />
              </label>
            </div>
          ) : (
            <div className="grid gap-2">
              <label className="grid gap-1">
                <span className="text-xs text-slate-500">{t("settings.modal.protocolId")}</span>
                <Input
                  value={newProtocolId}
                  onChange={(event) => {
                    setNewProtocolId(event.target.value);
                    setSaveMessage("");
                  }}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-slate-500">{t("settings.modal.protocolName")}</span>
                <Input
                  value={newProtocolName}
                  onChange={(event) => {
                    setNewProtocolName(event.target.value);
                    setSaveMessage("");
                  }}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-slate-500">{t("settings.baseUrl")}</span>
                <Input
                  value={newProtocolBaseUrl}
                  onChange={(event) => {
                    setNewProtocolBaseUrl(event.target.value);
                    setSaveMessage("");
                  }}
                />
              </label>
            </div>
          )}

          <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <label className="grid gap-1">
              <span className="text-xs text-slate-500">{t("settings.modal.modelDisplayName")}</span>
              <Input
                value={modelDisplayName}
                onChange={(event) => {
                  setModelDisplayName(event.target.value);
                  setSaveMessage("");
                }}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-slate-500">{t("settings.modal.modelRequestName")}</span>
              <Input
                value={modelRequestName}
                onChange={(event) => {
                  setModelRequestName(event.target.value);
                  setSaveMessage("");
                }}
              />
            </label>
            <label className="grid gap-1">
              <span className="inline-flex items-center gap-2 text-xs text-slate-500">
                {t("settings.apiKey")}
                {apiKeyChanged ? (
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full bg-primary-600"
                    title={t("settings.modal.apiKeyChanged")}
                  />
                ) : null}
              </span>
              <div className="relative">
                <Input
                  type={showApiKey ? "text" : "password"}
                  value={modelApiKey}
                  onChange={(event) => {
                    setModelApiKey(event.target.value);
                    setSaveMessage("");
                  }}
                  placeholder={t("settings.modal.apiKeyPlaceholderUpdate")}
                  className="pr-10 [appearance:textfield] [&::-ms-clear]:hidden [&::-ms-reveal]:hidden [&::-webkit-credentials-auto-fill-button]:hidden"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                  {loadingApiKey ? (
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-500">
                      <SvgSpinner className="h-3.5 w-3.5 text-slate-500" />
                    </span>
                  ) : (
                    <button
                      className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      title={showApiKey ? t("settings.modal.hideApiKey") : t("settings.modal.showApiKey")}
                      aria-label={showApiKey ? t("settings.modal.hideApiKey") : t("settings.modal.showApiKey")}
                      onClick={() => setShowApiKey((prev) => !prev)}
                      type="button"
                    >
                      {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  )}
                </div>
              </div>
              {loadingApiKey ? (
                <span className="text-[11px] text-slate-500">{t("common.loading")}</span>
              ) : null}
            </label>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-4">
          <div className="min-h-[16px] truncate text-xs text-slate-500">{saveMessage}</div>
          <div className="flex items-center gap-2">
            <Button
              disabled={!canSubmitBase || saving || loadingApiKey}
              onClick={() => {
                void handleSave();
              }}
            >
              {saving ? t("common.loading") : t("settings.saveSettings")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
