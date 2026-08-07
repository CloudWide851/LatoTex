export function shouldRefreshAgentRuntimesAtStartup(input: {
  startupReady: boolean;
  isTauriRuntime: boolean;
  refreshStarted: boolean;
}): boolean {
  return input.startupReady && input.isTauriRuntime && !input.refreshStarted;
}
