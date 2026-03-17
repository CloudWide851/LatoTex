function toErrorMessage(error: unknown): string {
  if (!error) {
    return "";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message || String(error);
  }
  if (typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string") {
      return maybeMessage;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

export function isMissingFileReadError(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  if (!message) {
    return false;
  }
  return [
    "enoent",
    "not found",
    "no such file",
    "cannot find the file",
    "does not exist",
    "system cannot find the file",
    "系统找不到指定的文件",
    "找不到指定的文件",
    "os error 2",
  ].some((needle) => message.includes(needle));
}
