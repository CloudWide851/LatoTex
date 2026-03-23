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
    <div className="flex h-full min-h-0 items-center justify-center text-xs text-slate-500">
      {props.label}
    </div>
  );
}
