import { useCallback } from "react";
import { getModelApiKey, getSettings, saveModelApiKeyVerified, testModel } from "../../shared/api/settings";
import type { ModelCatalogItem } from "../../shared/types/app";
import { runtimeLogWrite } from "../../shared/api/runtime";
import {
  resolveCredentialSaveErrorMessage,
  resolveReadbackFailureMessage,
  verifyModelApiKeyReadback,
} from "./modelApiKeySave";
import { generateGitSummary } from "./useGitSummaryGenerator";
import type { UseAppContainerWorkspaceActionsParams } from "./useAppContainerWorkspaceActions.types";

type ModelActionParams = Pick<
  UseAppContainerWorkspaceActionsParams,
  | "settings"
  | "setModelTestById"
  | "setModelTestActiveId"
  | "setModelTestBusy"
  | "persistSettings"
  | "cancelPendingAutoSave"
  | "setSettings"
  | "setDraftModelApiKeys"
  | "setToast"
  | "t"
  | "setModelModalMode"
  | "setModelModalInitial"
  | "setModelModalOpen"
> & {
  activeProjectId: string | null;
};

export function useModelSettingsActions(params: ModelActionParams) {
  const {
    activeProjectId,
    settings,
    setModelTestById,
    setModelTestActiveId,
    setModelTestBusy,
    persistSettings,
    cancelPendingAutoSave,
    setSettings,
    setDraftModelApiKeys,
    setToast,
    t,
  } = params;

  const handleTestModel = useCallback(async (modelId: string) => {
    setModelTestBusy(true);
    setModelTestActiveId(modelId);
    try {
      const result = await testModel(modelId);
      setModelTestById((prev: any) => ({ ...prev, [modelId]: result }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setModelTestById((prev: any) => ({
        ...prev,
        [modelId]: {
          modelId,
          ok: false,
          message,
        },
      }));
    } finally {
      setModelTestActiveId(null);
      setModelTestBusy(false);
    }
  }, [setModelTestActiveId, setModelTestBusy, setModelTestById]);

  const handleTestAllModels = useCallback(async () => {
    const catalog = settings?.modelCatalog ?? [];
    if (catalog.length === 0) {
      return;
    }
    setModelTestBusy(true);
    try {
      for (const model of catalog) {
        setModelTestActiveId(model.id);
        try {
          const result = await testModel(model.id);
          setModelTestById((prev: any) => ({ ...prev, [model.id]: result }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setModelTestById((prev: any) => ({
            ...prev,
            [model.id]: {
              modelId: model.id,
              ok: false,
              message,
            },
          }));
        }
      }
    } finally {
      setModelTestActiveId(null);
      setModelTestBusy(false);
    }
  }, [setModelTestActiveId, setModelTestBusy, setModelTestById, settings?.modelCatalog]);

  const openModelModal = useCallback((mode: "create" | "edit" | "duplicate" = "create", model: ModelCatalogItem | null = null) => {
    params.setModelModalMode(mode);
    params.setModelModalInitial(model);
    params.setModelModalOpen(true);
  }, [params]);

  const handleGetModelApiKey = useCallback(async (modelId: string) => {
    const result = await getModelApiKey(modelId);
    return result.apiKey ?? "";
  }, []);

  const handleGenerateGitSummary = useCallback(async (includedPaths: string[]) => {
    return generateGitSummary(activeProjectId, includedPaths);
  }, [activeProjectId]);

  const handleModelModalSubmit = useCallback(async (payload: {
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
  }): Promise<{ ok: boolean; message?: string }> => {
    const { protocol, model, modelApiKey, modelApiKeyChanged } = payload;
    if (!settings) {
      return { ok: false, message: t("toast.settingsNotLoaded") };
    }
    cancelPendingAutoSave?.();

    const normalizedKey = modelApiKey?.trim() ?? "";
    const nextProtocols = protocol.isNew
      ? [
          ...settings.modelProtocols,
          {
            id: protocol.id,
            displayName: protocol.displayName,
            baseUrl: protocol.baseUrl,
            apiKeySet: false,
          },
        ]
      : settings.modelProtocols.map((item: any) =>
          item.id === protocol.id
            ? {
                ...item,
                baseUrl: protocol.baseUrl,
              }
            : item,
        );
    const nextCatalog = settings.modelCatalog.some((item: any) => item.id === model.id)
      ? settings.modelCatalog.map((item: any) => (item.id === model.id ? model : item))
      : [...settings.modelCatalog, model];
    const nextSettings = {
      ...settings,
      modelProtocols: nextProtocols,
      modelCatalog: nextCatalog,
    };

    try {
      await runtimeLogWrite("INFO", `model save started: ${model.id}`).catch(() => undefined);
      await persistSettings(nextSettings);
      if (modelApiKeyChanged) {
        const result = await saveModelApiKeyVerified({
          modelId: model.id,
          apiKey: normalizedKey,
        });
        if (!result.ok) {
          const friendlyMessage = resolveCredentialSaveErrorMessage(result, t);
          await runtimeLogWrite(
            "WARN",
            `model key save failed: ${model.id}, stage=${result.stage}, backend=${result.storageBackend}, diagnostic=${result.diagnosticCode ?? "-"}, readback_source=${result.readbackSource ?? "-"}, readback_attempts=${result.readbackAttempts ?? "-"}, reason=${result.message}`,
          ).catch(() => undefined);
          throw new Error(friendlyMessage);
        }

        const readback = await verifyModelApiKeyReadback(model.id, normalizedKey);
        if (!readback.ok) {
          const friendlyMessage = resolveReadbackFailureMessage(readback, t);
          await runtimeLogWrite(
            "ERROR",
            `model key frontend readback failed: ${model.id}, attempts=${readback.attempts}, expected_len=${normalizedKey.length}, actual_len=${readback.keyLength}, source=${readback.source}, diagnostic=${readback.diagnosticCode ?? "-"}`,
          ).catch(() => undefined);
          throw new Error(friendlyMessage);
        }
        await runtimeLogWrite(
          "INFO",
          `model key frontend readback ok: ${model.id}, attempts=${readback.attempts}, key_len=${readback.keyLength}, source=${readback.source}, diagnostic=${readback.diagnosticCode ?? "-"}`,
        ).catch(() => undefined);
      }
      const refreshed = await getSettings();
      setSettings(refreshed);
      setDraftModelApiKeys((current: Record<string, string>) => {
        if (!(model.id in current)) {
          return current;
        }
        const next = { ...current };
        delete next[model.id];
        return next;
      });
      await runtimeLogWrite("INFO", `model save completed: ${model.id}`).catch(() => undefined);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setToast({ type: "error", message });
      await runtimeLogWrite("ERROR", `model save failed: ${model.id}, reason=${message}`).catch(() => undefined);
      return { ok: false, message };
    }
  }, [cancelPendingAutoSave, persistSettings, setDraftModelApiKeys, setSettings, setToast, settings, t]);

  return {
    handleTestModel,
    handleTestAllModels,
    handleGetModelApiKey,
    openModelModal,
    handleGenerateGitSummary,
    handleModelModalSubmit,
  };
}
