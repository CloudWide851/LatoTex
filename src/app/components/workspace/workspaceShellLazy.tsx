import { lazy } from "react";

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
