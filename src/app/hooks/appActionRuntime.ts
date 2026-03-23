import { runtimeLogWrite } from "../../shared/api/runtime";
import { formatRuntimeErrorForLog, resolveRuntimeErrorMessage } from "../../shared/runtime/errors";

type ToastValue = { type: "info" | "error"; message: string };
type ToastSetter = (value: ToastValue) => void;

type AppActionOptions<T> = {
  action: () => Promise<T>;
  fallbackValue: T;
  setBusy?: (value: boolean) => void;
  setToast?: ToastSetter;
  successMessage?: string;
  errorMessage?: string;
  successLogMessage?: string;
  errorLogLabel?: string;
  onSuccess?: (value: T) => Promise<void> | void;
  onError?: (error: unknown) => Promise<void> | void;
};

export async function writeRuntimeLog(level: string, message: string) {
  try {
    await runtimeLogWrite(level, message);
  } catch {
    // ignore logging failures in UI paths
  }
}

export async function runAppAction<T>(options: AppActionOptions<T>): Promise<T> {
  const {
    action,
    fallbackValue,
    setBusy,
    setToast,
    successMessage,
    errorMessage,
    successLogMessage,
    errorLogLabel,
    onSuccess,
    onError,
  } = options;

  setBusy?.(true);
  try {
    const value = await action();
    await onSuccess?.(value);
    if (successMessage && setToast) {
      setToast({ type: "info", message: successMessage });
    }
    if (successLogMessage) {
      await writeRuntimeLog("INFO", successLogMessage);
    }
    return value;
  } catch (error) {
    await onError?.(error);
    const message = resolveRuntimeErrorMessage(error, errorMessage ?? "Unknown error");
    if (setToast) {
      setToast({ type: "error", message });
    }
    if (errorLogLabel) {
      await writeRuntimeLog("ERROR", `${errorLogLabel}: ${formatRuntimeErrorForLog(error, message)}`);
    }
    return fallbackValue;
  } finally {
    setBusy?.(false);
  }
}
