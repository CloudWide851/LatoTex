import { Suspense, lazy, useEffect } from "react";
import type { AppWorkspaceShellProps } from "./workspaceShellTypes";

export const LazyAgentChatOverlay = lazy(async () => {
  const module = await import("../AgentChatOverlay");
  return { default: module.AgentChatOverlay };
});

export const LazyLibraryDocumentViewer = lazy(async () => {
  const module = await import("../LibraryDocumentViewer");
  return { default: module.LibraryDocumentViewer };
});

export const LazyChatWorkspace = lazy(async () => {
  const module = await import("../chat/ChatWorkspace");
  return { default: module.ChatWorkspace };
});

export const LazyDrawWorkspace = lazy(async () => {
  const module = await import("../draw/DrawWorkspace");
  return { default: module.DrawWorkspace };
});

export const LazyDocxWorkspace = lazy(async () => {
  const module = await import("../docx/DocxWorkspace");
  return { default: module.DocxWorkspace };
});

export const LazyPluginMarketplace = lazy(async () => {
  const module = await import("../plugins/PluginMarketplace");
  return { default: module.PluginMarketplace };
});

export function LazyPluginMarketplaceSurface(props: Pick<AppWorkspaceShellProps, "settings" | "t">) {
  return (
    <Suspense fallback={<WorkspacePanelFallback label={props.t("common.loading")} />}>
      <LazyPluginMarketplace settings={props.settings} t={props.t} />
    </Suspense>
  );
}

export function LazyDocxWorkspaceSurface(props: {
  shell: AppWorkspaceShellProps;
  selectedIsDocx: boolean;
}) {
  const { shell, selectedIsDocx } = props;
  return (
    <Suspense fallback={<WorkspacePanelFallback label={shell.t("common.loading")} />}>
      <LazyDocxWorkspace
        projectId={shell.activeProjectId ?? ""}
        selectedPath={selectedIsDocx ? shell.selectedFile : null}
        busy={shell.busy}
        tree={shell.tree}
        autoSaveEnabled={shell.settings?.uiPrefs?.docxAutoSaveEnabled ?? false}
        onRescan={shell.onWorkspaceRescan}
        t={shell.t}
      />
    </Suspense>
  );
}

export function preloadDrawWorkspace() {
  void import("../draw/DrawWorkspace");
}

export function useDrawWorkspacePreload(enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const hasIdleCallback = "requestIdleCallback" in window && "cancelIdleCallback" in window;
    const handle = hasIdleCallback
      ? idleWindow.requestIdleCallback(preloadDrawWorkspace, { timeout: 4_000 })
      : window.setTimeout(preloadDrawWorkspace, 2_000);
    return () => {
      if (hasIdleCallback && idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(handle);
      } else {
        window.clearTimeout(handle);
      }
    };
  }, [enabled]);
}

export function WorkspacePanelFallback(props: { label: string }) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-[color:var(--editor-paper-bg)] text-[color:var(--editor-tab-muted)]">
      <div className="grid min-w-40 gap-3 rounded-md border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-widget-bg)] px-4 py-3 text-center shadow-sm">
        <div className="mx-auto h-1.5 w-24 overflow-hidden rounded-full bg-[color:var(--editor-paper-edge)]">
          <div className="h-full w-10 animate-pulse rounded-full bg-[color:var(--app-accent)]" />
        </div>
        <span className="text-xs">{props.label}</span>
      </div>
    </div>
  );
}
