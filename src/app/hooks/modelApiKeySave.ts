import { getModelApiKey } from "../../shared/api/desktop";
import type { CredentialSaveResult } from "../../shared/types/app";

type TranslationFn = (key: string) => string;

export type ModelApiKeyReadbackResult = {
  ok: boolean;
  attempts: number;
  keyLength: number;
  source: string;
  diagnosticCode?: string;
};

const SAVE_DIAGNOSTIC_MESSAGE_MAP: Record<string, string> = {
  SECURE_STORE_WRITE_FAILED: "settings.modal.saveFailedStorageUnavailable",
  SECURE_STORE_READ_FAILED: "settings.modal.saveFailedReadback",
  KEY_READ_EMPTY_AFTER_WRITE: "settings.modal.saveFailedReadbackEmpty",
  KEY_READ_SOURCE_DRIFT_EMPTY: "settings.modal.saveFailedReadbackEmpty",
  KEY_READ_NON_EMPTY_MISMATCH_AFTER_WRITE: "settings.modal.saveFailedReadback",
  KEY_READBACK_RETRY_EXHAUSTED: "settings.modal.saveFailedReadbackRetryExhausted",
  KEY_CLEAR_READBACK_MISMATCH: "settings.modal.saveFailedReadback",
  SECURE_STORE_CLEAR_FAILED: "settings.modal.saveFailedStorageUnavailable",
  FALLBACK_DB_DECRYPT_FAILED: "settings.modal.saveFailedDecrypt",
  FALLBACK_DB_DECRYPT_FAILED_FILE_KEY: "settings.modal.saveFailedDecrypt",
  MASTER_KEY_KEYRING_READ_FAILED: "settings.modal.saveFailedMasterKeyUnavailable",
  MASTER_KEY_MISMATCH_RECOVER_WRITE_FAILED: "settings.modal.saveFailedReadback",
};

const READBACK_DIAGNOSTIC_MESSAGE_MAP: Record<string, string> = {
  KEYRING_READ_FAILED: "settings.modal.saveFailedReadback",
  KEYRING_READ_FAILED_FALLBACK_DB: "settings.modal.saveFailedReadback",
  KEYRING_EMPTY_FALLBACK_DB: "settings.modal.saveFailedReadback",
  FALLBACK_DB_DECRYPT_FAILED: "settings.modal.saveFailedDecrypt",
  FALLBACK_DB_DECRYPT_FAILED_FILE_KEY: "settings.modal.saveFailedDecrypt",
  MASTER_KEY_KEYRING_READ_FAILED: "settings.modal.saveFailedMasterKeyUnavailable",
  MASTER_KEY_MISMATCH_RECOVER_WRITE_FAILED: "settings.modal.saveFailedReadback",
};

export async function verifyModelApiKeyReadback(
  modelId: string,
  expectedApiKey: string,
): Promise<ModelApiKeyReadbackResult> {
  const normalizedExpected = expectedApiKey.trim();
  const expectCleared = normalizedExpected.length === 0;
  const retryDelays = [0, 120, 280, 520];
  let lastRead = "";
  let lastSource = "none";
  let lastDiagnostic: string | undefined;

  for (let index = 0; index < retryDelays.length; index += 1) {
    const delay = retryDelays[index];
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    const loaded = await getModelApiKey(modelId);
    const normalizedRead = (loaded.apiKey ?? "").trim();
    lastRead = normalizedRead;
    lastSource = loaded.source ?? "none";
    lastDiagnostic = loaded.diagnosticCode ?? undefined;

    if (expectCleared) {
      if (normalizedRead.length === 0) {
        return { ok: true, attempts: index + 1, keyLength: 0, source: lastSource, diagnosticCode: lastDiagnostic };
      }
    } else if (normalizedRead.length > 0 && normalizedRead === normalizedExpected) {
      return {
        ok: true,
        attempts: index + 1,
        keyLength: normalizedRead.length,
        source: lastSource,
        diagnosticCode: lastDiagnostic,
      };
    }
  }

  return {
    ok: false,
    attempts: retryDelays.length,
    keyLength: lastRead.length,
    source: lastSource,
    diagnosticCode: lastDiagnostic,
  };
}

export function resolveCredentialSaveErrorMessage(
  result: CredentialSaveResult,
  t: TranslationFn,
): string {
  const mappedKey =
    (result.diagnosticCode && SAVE_DIAGNOSTIC_MESSAGE_MAP[result.diagnosticCode]) ??
    undefined;
  if (mappedKey) {
    return t(mappedKey);
  }
  if (result.message?.trim()) {
    return result.message;
  }
  return t("settings.modal.saveFailed");
}

export function resolveReadbackFailureMessage(
  readback: ModelApiKeyReadbackResult,
  t: TranslationFn,
): string {
  const mappedKey =
    (readback.diagnosticCode && READBACK_DIAGNOSTIC_MESSAGE_MAP[readback.diagnosticCode]) ??
    undefined;
  if (mappedKey) {
    return t(mappedKey);
  }
  if (readback.keyLength === 0) {
    return t("settings.modal.saveFailedReadbackEmpty");
  }
  return t("settings.modal.saveFailedReadback");
}
