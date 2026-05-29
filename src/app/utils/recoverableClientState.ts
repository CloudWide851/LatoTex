const RECOVERABLE_CLIENT_STATE_PREFIXES = [
  "latotex.latex.workspace.session.",
  "latotex.workspace.page",
];

export function clearRecoverableClientState() {
  if (typeof window === "undefined") {
    return;
  }
  for (const key of Object.keys(window.localStorage)) {
    if (RECOVERABLE_CLIENT_STATE_PREFIXES.some((prefix) => key === prefix || key.startsWith(prefix))) {
      window.localStorage.removeItem(key);
    }
  }
}
