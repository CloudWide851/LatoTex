import { Beaker, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import type { ModelCatalogItem, ModelProtocol } from "../../shared/types/app";

type TranslationFn = (key: any) => string;

export function ModelModal(props: {
  open: boolean;
  mode?: "create" | "edit";
  initialModel?: ModelCatalogItem | null;
  protocols: ModelProtocol[];
  onClose: () => void;
  onTest: (input: {
    protocolId: string;
    baseUrl: string;
    apiKey?: string;
    requestName?: string;
  }) => Promise<boolean>;
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
    modelApiKeyAction: "keep" | "set" | "clear";
  }) => void;
  t: TranslationFn;
}) {
  const { open, mode: dialogMode = "create", initialModel, protocols, onClose, onTest, onSubmit, t } = props;
  const [protocolMode, setProtocolMode] = useState<"existing" | "new">("existing");
  const [protocolId, setProtocolId] = useState(protocols[0]?.id ?? "openai-compatible");
  const [newProtocolId, setNewProtocolId] = useState("");
  const [newProtocolName, setNewProtocolName] = useState("");
  const [newProtocolBaseUrl, setNewProtocolBaseUrl] = useState("");
  const [existingProtocolBaseUrl, setExistingProtocolBaseUrl] = useState("");
  const [modelDisplayName, setModelDisplayName] = useState("");
  const [modelRequestName, setModelRequestName] = useState("");
  const [modelApiKey, setModelApiKey] = useState("");
  const [apiKeyMode, setApiKeyMode] = useState<"keep" | "update" | "clear">("update");
  const [testState, setTestState] = useState<"idle" | "ok" | "fail">("idle");
  const [testing, setTesting] = useState(false);

  const selectedProtocol = useMemo(
    () => protocols.find((item) => item.id === protocolId),
    [protocolId, protocols],
  );

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
    setApiKeyMode(dialogMode === "edit" ? "keep" : "update");
    setTestState(dialogMode === "edit" ? "ok" : "idle");
    setTesting(false);
  }, [dialogMode, initialModel?.displayName, initialModel?.protocolId, initialModel?.requestName, open, protocols]);

  if (!open) {
    return null;
  }

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

  const modelApiKeyAction: "keep" | "set" | "clear" = dialogMode === "edit"
    ? apiKeyMode === "keep"
      ? "keep"
      : apiKeyMode === "clear"
        ? "clear"
        : "set"
    : modelApiKey.trim().length > 0
      ? "set"
      : "keep";

  const canSubmit =
    resolvedProtocol.id.length > 0 &&
    resolvedProtocol.displayName.length > 0 &&
    resolvedProtocol.baseUrl.length > 0 &&
    modelDisplayName.trim().length > 0 &&
    modelRequestName.trim().length > 0 &&
    (modelApiKeyAction !== "set" || modelApiKey.trim().length > 0) &&
    testState === "ok";

  const handleTest = async () => {
    if (!resolvedProtocol.baseUrl.trim() || !modelRequestName.trim() || !modelApiKey.trim()) {
      setTestState("fail");
      return;
    }
    const testStart = Date.now();
    setTesting(true);
    try {
      const ok = await onTest({
        protocolId: resolvedProtocol.id,
        baseUrl: resolvedProtocol.baseUrl,
        apiKey: resolvedProtocol.apiKey || undefined,
        requestName: modelRequestName.trim(),
      });
      const elapsed = Date.now() - testStart;
      if (elapsed < 600) {
        await new Promise((resolve) => setTimeout(resolve, 600 - elapsed));
      }
      setTestState(ok ? "ok" : "fail");
    } finally {
      setTesting(false);
    }
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
                    setTestState("idle");
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
                    setTestState("idle");
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
                    setTestState("idle");
                  }}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-slate-500">{t("settings.modal.protocolName")}</span>
                <Input
                  value={newProtocolName}
                  onChange={(event) => {
                    setNewProtocolName(event.target.value);
                    setTestState("idle");
                  }}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-slate-500">{t("settings.baseUrl")}</span>
                <Input
                  value={newProtocolBaseUrl}
                  onChange={(event) => {
                    setNewProtocolBaseUrl(event.target.value);
                    setTestState("idle");
                  }}
                />
              </label>
            </div>
          )}

          <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <label className="grid gap-1">
              <span className="text-xs text-slate-500">{t("settings.modal.modelDisplayName")}</span>
              <Input value={modelDisplayName} onChange={(e) => setModelDisplayName(e.target.value)} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-slate-500">{t("settings.modal.modelRequestName")}</span>
              <Input value={modelRequestName} onChange={(e) => setModelRequestName(e.target.value)} />
            </label>
            {dialogMode === "edit" && (
              <div className="grid gap-1">
                <span className="text-xs text-slate-500">{t("settings.apiKey")}</span>
                <div className="grid grid-cols-3 gap-1">
                  <button
                    className={`rounded-md border px-2 py-1 text-xs transition ${
                      apiKeyMode === "keep"
                        ? "border-primary-600 bg-primary-600 text-white"
                        : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                    }`}
                    onClick={() => {
                      setApiKeyMode("keep");
                      setModelApiKey("");
                    }}
                    type="button"
                  >
                    {t("settings.modal.apiKeyMode.keep")}
                  </button>
                  <button
                    className={`rounded-md border px-2 py-1 text-xs transition ${
                      apiKeyMode === "update"
                        ? "border-primary-600 bg-primary-600 text-white"
                        : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                    }`}
                    onClick={() => setApiKeyMode("update")}
                    type="button"
                  >
                    {t("settings.modal.apiKeyMode.update")}
                  </button>
                  <button
                    className={`rounded-md border px-2 py-1 text-xs transition ${
                      apiKeyMode === "clear"
                        ? "border-primary-600 bg-primary-600 text-white"
                        : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                    }`}
                    onClick={() => {
                      setApiKeyMode("clear");
                      setModelApiKey("");
                    }}
                    type="button"
                  >
                    {t("settings.modal.apiKeyMode.clear")}
                  </button>
                </div>
              </div>
            )}
            <label className="grid gap-1">
              <span className="text-xs text-slate-500">{t("settings.apiKey")}</span>
              <Input
                type="password"
                value={modelApiKey}
                disabled={dialogMode === "edit" && apiKeyMode !== "update"}
                onChange={(event) => {
                  setModelApiKey(event.target.value);
                  if (dialogMode === "edit") {
                    setApiKeyMode("update");
                  }
                  setTestState("idle");
                }}
                placeholder={
                  dialogMode === "edit" && apiKeyMode !== "update"
                    ? t("settings.modal.apiKeyPlaceholderKeep")
                    : t("settings.modal.apiKeyPlaceholderUpdate")
                }
              />
            </label>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-4">
          <div className="text-xs text-slate-500">
            {testState === "ok" ? t("settings.modal.testOk") : testState === "fail" ? t("settings.modal.testFail") : t("settings.modal.testIdle")}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded border border-slate-300 bg-white p-2 text-slate-600 transition hover:bg-slate-100"
              onClick={handleTest}
              disabled={testing}
              title={t("settings.testProtocol")}
            >
              <Beaker className="h-4 w-4" />
            </button>
            <Button
              disabled={!canSubmit}
              onClick={() => {
                const requestName = modelRequestName.trim();
                const modelId = dialogMode === "edit" && initialModel?.id
                  ? initialModel.id
                  : `${resolvedProtocol.id}-${requestName.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`;
                onSubmit({
                  protocol: resolvedProtocol,
                  model: {
                    id: modelId,
                    protocolId: resolvedProtocol.id,
                    displayName: modelDisplayName.trim(),
                    requestName,
                  },
                  modelApiKeyAction,
                  modelApiKey:
                    modelApiKeyAction === "set" ? modelApiKey.trim() || undefined : undefined,
                });
                onClose();
              }}
            >
              {t("settings.saveSettings")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
