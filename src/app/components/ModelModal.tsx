import { Beaker, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import type { ModelCatalogItem, ModelProtocol } from "../../shared/types/app";

type TranslationFn = (key: any) => string;

export function ModelModal(props: {
  open: boolean;
  protocols: ModelProtocol[];
  onClose: () => void;
  onTest: (input: { protocolId: string; baseUrl: string; apiKey?: string }) => Promise<boolean>;
  onSubmit: (payload: {
    protocol: {
      id: string;
      displayName: string;
      baseUrl: string;
      apiKey?: string;
      isNew: boolean;
    };
    model: ModelCatalogItem;
  }) => void;
  t: TranslationFn;
}) {
  const { open, protocols, onClose, onTest, onSubmit, t } = props;
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [protocolId, setProtocolId] = useState(protocols[0]?.id ?? "openai-compatible");
  const [newProtocolId, setNewProtocolId] = useState("");
  const [newProtocolName, setNewProtocolName] = useState("");
  const [newProtocolBaseUrl, setNewProtocolBaseUrl] = useState("");
  const [newProtocolApiKey, setNewProtocolApiKey] = useState("");
  const [existingProtocolBaseUrl, setExistingProtocolBaseUrl] = useState("");
  const [existingProtocolApiKey, setExistingProtocolApiKey] = useState("");
  const [modelDisplayName, setModelDisplayName] = useState("");
  const [modelRequestName, setModelRequestName] = useState("");
  const [testState, setTestState] = useState<"idle" | "ok" | "fail">("idle");
  const [testing, setTesting] = useState(false);

  const selectedProtocol = useMemo(
    () => protocols.find((item) => item.id === protocolId),
    [protocolId, protocols],
  );

  useEffect(() => {
    setExistingProtocolBaseUrl(selectedProtocol?.baseUrl ?? "");
    setExistingProtocolApiKey("");
  }, [selectedProtocol?.baseUrl, selectedProtocol?.id]);

  if (!open) {
    return null;
  }

  const resolvedProtocol = mode === "new"
    ? {
        id: newProtocolId.trim(),
        displayName: newProtocolName.trim(),
        baseUrl: newProtocolBaseUrl.trim(),
        apiKey: newProtocolApiKey.trim(),
        isNew: true,
      }
    : {
        id: protocolId,
        displayName: selectedProtocol?.displayName ?? protocolId,
        baseUrl: existingProtocolBaseUrl.trim(),
        apiKey: existingProtocolApiKey.trim(),
        isNew: false,
      };

  const canSubmit =
    resolvedProtocol.id.length > 0 &&
    resolvedProtocol.displayName.length > 0 &&
    resolvedProtocol.baseUrl.length > 0 &&
    modelDisplayName.trim().length > 0 &&
    modelRequestName.trim().length > 0 &&
    testState === "ok";

  const handleTest = async () => {
    if (!resolvedProtocol.baseUrl.trim()) {
      setTestState("fail");
      return;
    }
    setTesting(true);
    try {
      const ok = await onTest({
        protocolId: resolvedProtocol.id,
        baseUrl: resolvedProtocol.baseUrl,
        apiKey: resolvedProtocol.apiKey || undefined,
      });
      setTestState(ok ? "ok" : "fail");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 motion-fade-in">
      <div className="grid h-[min(84vh,780px)] w-full max-w-2xl grid-rows-[52px_minmax(0,1fr)_64px] overflow-hidden rounded-lg border border-slate-300 bg-white shadow-soft motion-slide-up">
        <div className="flex items-center justify-between border-b border-slate-200 px-4">
          <h3 className="text-sm font-semibold text-slate-800">{t("settings.addModel")}</h3>
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
              variant={mode === "existing" ? "default" : "secondary"}
              onClick={() => setMode("existing")}
            >
              {t("settings.modal.useExistingProtocol")}
            </Button>
            <Button
              variant={mode === "new" ? "default" : "secondary"}
              onClick={() => setMode("new")}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("settings.modal.createProtocol")}
            </Button>
          </div>

          {mode === "existing" ? (
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
              <label className="grid gap-1">
                <span className="text-xs text-slate-500">{t("settings.apiKey")}</span>
                <Input
                  type="password"
                  value={existingProtocolApiKey}
                  onChange={(event) => {
                    setExistingProtocolApiKey(event.target.value);
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
              <label className="grid gap-1">
                <span className="text-xs text-slate-500">{t("settings.apiKey")}</span>
                <Input
                  type="password"
                  value={newProtocolApiKey}
                  onChange={(event) => setNewProtocolApiKey(event.target.value)}
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
                onSubmit({
                  protocol: resolvedProtocol,
                  model: {
                    id: `${resolvedProtocol.id}-${modelRequestName.trim().replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`,
                    protocolId: resolvedProtocol.id,
                    displayName: modelDisplayName.trim(),
                    requestName: modelRequestName.trim(),
                  },
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
