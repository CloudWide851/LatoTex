function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function normalizeAssetBasePath(input: string): string {
  const decoded = safeDecodeUriComponent((input ?? "").trim());
  const withForwardSlash = decoded.replace(/\\/g, "/");
  const protocolMatch = withForwardSlash.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//);
  const protocolPrefix = protocolMatch?.[0] ?? "";
  const tail = protocolPrefix ? withForwardSlash.slice(protocolPrefix.length) : withForwardSlash;
  const normalizedTail = tail.replace(/\/{2,}/g, "/");
  return `${protocolPrefix}${normalizedTail}`.replace(/^(\.)\/+/, "./").replace(/\/+$/, "");
}
